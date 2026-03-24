import { findOrCreateUser, updateUser } from '../db/users.js';
import { sendTextMessage, sendButtonMessage, showTyping, markAsRead, reactToMessage } from '../whatsapp/sender.js';
import { handleOnboarding, getPostChartButtons } from './onboardingHandler.js';
import { getSessionContext, saveExchange } from './sessionManager.js';
import { dispatchToAgent } from '../ai/agents/dispatcher.js';
import { AGENTS } from '../ai/agents/router.js';
import { generateHook } from '../ai/responder.js';
import { calculateDelay, sleep } from '../utils/delay.js';
import { detectLanguage, detectScript, isLanguageNeutral, t } from '../languages/index.js';
import { logger } from '../utils/logger.js';

// Handle unsupported message types (voice, image, sticker, etc.)
export async function handleUnsupportedType(whatsappId, messageType, messageId) {
  await markAsRead(messageId).catch(() => {});

  const { findOrCreateUser } = await import('../db/users.js');
  const user = await findOrCreateUser(whatsappId, null);
  const lang = user?.language || 'hi';

  const responses = {
    hi: {
      audio: 'Abhi main sirf text padh sakti hoon 😊 Voice note ki jagah likh kar bhejiye na?',
      voice: 'Abhi main sirf text padh sakti hoon 😊 Voice note ki jagah likh kar bhejiye na?',
      image: 'Photo mil gayi, par abhi main sirf text se kaam karti hoon 😊 Apna sawaal likh kar bhejiye?',
      video: 'Video abhi nahi dekh sakti 😊 Text mein bataiye kya jaanna hai?',
      sticker: '😊',
      default: 'Abhi main sirf text messages padh sakti hoon. Likh kar bhejiye na?',
    },
    en: {
      audio: "I can only read text for now 😊 Could you type your message instead?",
      voice: "I can only read text for now 😊 Could you type your message instead?",
      image: "Got the image, but I can only work with text right now 😊 What would you like to know?",
      video: "Can't watch videos yet 😊 Please type your question?",
      sticker: '😊',
      default: "I can only read text messages for now. Could you type it out?",
    },
  };

  const langResponses = responses[lang] || responses.hi;
  const reply = langResponses[messageType] || langResponses.default;

  // Don't respond to stickers with a full message — just react
  if (messageType === 'sticker') {
    await reactToMessage(whatsappId, messageId, '😊').catch(() => {});
    return;
  }

  await sendTextMessage(whatsappId, reply);
}

// Per-user message queue to prevent race conditions
const userLocks = new Map();

async function withUserLock(whatsappId, fn) {
  const prev = userLocks.get(whatsappId) || Promise.resolve();
  const current = prev.then(fn, fn);
  userLocks.set(whatsappId, current);
  current.finally(() => {
    if (userLocks.get(whatsappId) === current) {
      userLocks.delete(whatsappId);
    }
  });
  return current;
}

// Message debouncing: wait for user to finish typing before processing
// Collects rapid-fire messages into one batch (3.5s window)
const messageBuffers = new Map();

// Per-user rate limiting — max 10 messages per minute
const userRateLimits = new Map();

function isRateLimited(whatsappId) {
  const now = Date.now();
  const entry = userRateLimits.get(whatsappId);
  if (!entry) {
    userRateLimits.set(whatsappId, { count: 1, windowStart: now });
    return false;
  }
  // Reset window after 60s
  if (now - entry.windowStart > 60000) {
    userRateLimits.set(whatsappId, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  if (entry.count > 10) {
    logger.warn({ whatsappId, count: entry.count }, 'User rate limited');
    return true;
  }
  return false;
}

export async function handleIncomingMessage(whatsappId, displayName, messageText, messageId) {
  // Per-user rate limit — silently drop if spamming
  if (isRateLimited(whatsappId)) {
    await markAsRead(messageId).catch(() => {});
    return;
  }

  // Immediately mark as read + show typing (instant feedback)
  await Promise.all([
    markAsRead(messageId).catch(() => {}),
    showTyping(messageId).catch(() => {}),
  ]);

  // Add to buffer
  let buffer = messageBuffers.get(whatsappId);
  if (!buffer) {
    buffer = { messages: [], displayName, messageIds: [], timer: null };
    messageBuffers.set(whatsappId, buffer);
  }
  buffer.messages.push(messageText);
  buffer.messageIds.push(messageId);
  buffer.displayName = displayName;

  // Reset debounce timer
  if (buffer.timer) clearTimeout(buffer.timer);

  buffer.timer = setTimeout(() => {
    const buf = messageBuffers.get(whatsappId);
    if (!buf) return;
    messageBuffers.delete(whatsappId);

    const joinedText = buf.messages.join('\n');
    const lastMessageId = buf.messageIds[buf.messageIds.length - 1];

    logger.info({ whatsappId, messageCount: buf.messages.length }, 'Processing debounced messages');

    // Process through user lock
    withUserLock(whatsappId, () =>
      processMessage(whatsappId, buf.displayName, joinedText, lastMessageId)
    ).catch(err => {
      logger.error({ err, whatsappId }, 'Debounced processing failed');
    });
  }, 3500); // 3.5s debounce window
}

// Thinking simulation with cooldown (max once per 10 min per user)
const thinkingCooldowns = new Map();

async function sendWithThinking(whatsappId, messageId, responseText, lang, isComplex) {
  if (!isComplex) {
    await sendMultiPart(whatsappId, messageId, responseText);
    return;
  }

  const now = Date.now();
  const lastThinking = thinkingCooldowns.get(whatsappId) || 0;
  const shouldThink = now - lastThinking > 600000; // 10 min cooldown

  if (shouldThink) {
    const thinkingPhrases = t(lang, 'thinking_phrases');
    let phrase = 'Hmm...';
    if (Array.isArray(thinkingPhrases)) {
      phrase = thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)];
    }
    await sendTextMessage(whatsappId, phrase);
    thinkingCooldowns.set(whatsappId, now);
    await sleep(2000 + Math.random() * 1500);
  } else {
    await sleep(1000 + Math.random() * 1000);
  }

  await sendMultiPart(whatsappId, messageId, responseText);
}

// Split AI responses on --- delimiter into multiple WhatsApp messages (max 2)
async function sendMultiPart(whatsappId, messageId, text) {
  // Strip empty preambles that AI loves to add
  const cleaned = text
    .replace(/^(Achha toh\.{0,3}|Dekho\.{0,3}|So\.{0,3}|Hmm\.{0,3}|Interesting\.{0,3})\s*\n+/i, '')
    .trim();

  const parts = cleaned.split(/\n---\n|^---\n|\n---$/gm)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Cap at 2 parts max
  if (parts.length > 2) {
    const merged = parts.slice(1).join('\n\n');
    parts.length = 1;
    parts.push(merged);
  }

  if (parts.length <= 1) {
    await sendTextMessage(whatsappId, cleaned);
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      await showTyping(messageId);
      await sleep(1500 + Math.random() * 1000);
    }
    await sendTextMessage(whatsappId, parts[i]);
  }
}

async function processMessage(whatsappId, displayName, messageText, messageId) {
  const startTime = Date.now();
  let user;

  try {
    // Show typing (refresh since debounce delay may have expired it)
    await showTyping(messageId);

    // Find or create user
    user = await findOrCreateUser(whatsappId, displayName);
    logger.info({ userId: user.id }, 'Processing message');

    // Gender detection from self-identification (reactive, not a separate step)
    if (!user.gender) {
      const malePattern = /\b(i am a man|i('m| am) male|main ladka|mein ladka|mai ladka|main purush|ladka hoon|aadmi hoon|male hoon|bhai hoon|man hoon)\b/i;
      const femalePattern = /\b(i am a woman|i('m| am) female|main ladki|mein ladki|mai ladki|main mahila|ladki hoon|aurat hoon|female hoon|woman hoon)\b/i;
      if (malePattern.test(messageText)) {
        await updateUser(user.id, { gender: 'male' }).catch(() => {});
        user.gender = 'male';
      } else if (femalePattern.test(messageText)) {
        await updateUser(user.id, { gender: 'female' }).catch(() => {});
        user.gender = 'female';
      }
    }

    // Language detection (post-onboarding only)
    if (user.is_onboarded) {
      if (!isLanguageNeutral(messageText)) {
        const detectedLang = detectLanguage(messageText, user.language);
        if (detectedLang !== 'en' && detectedLang !== user.language) {
          await updateUser(user.id, { language: detectedLang }).catch(err => {
            logger.warn({ err: err.message, userId: user.id }, 'Failed to persist language update');
          });
          user.language = detectedLang;
        }
      }
    }

    // Route to handler — NEVER re-enter onboarding if user has chart data
    if (!user.is_onboarded && !user.chart_data) {
      await handleOnboardingFlow(whatsappId, user, messageText, messageId, startTime);
      return;
    }

    // Safety: if user has chart_data but is_onboarded is somehow false, fix it
    if (!user.is_onboarded && user.chart_data) {
      await updateUser(user.id, { is_onboarded: true, onboarding_step: 'onboarded' }).catch(() => {});
      user.is_onboarded = true;
      logger.warn({ userId: user.id }, 'Fixed inconsistent onboarding state — had chart_data but is_onboarded=false');
    }

    if (user.is_onboarded && !user.chart_summary && user.chart_data) {
      await handleHookFlow(whatsappId, user, messageText, messageId, startTime);
      return;
    }

    await handleAIConversation(whatsappId, user, messageText, messageId, startTime);
  } catch (err) {
    logger.error({ err, whatsappId }, 'Failed to handle message');
    const now = Date.now();
    const lastErr = userLocks.get(`err_${whatsappId}`);
    if (lastErr && now - lastErr < 60000) return;
    userLocks.set(`err_${whatsappId}`, now);
    try {
      const errorLang = user?.language || 'en';
      await sendTextMessage(whatsappId, t(errorLang, 'generic_error'));
    } catch {
      logger.error({ whatsappId }, 'Failed to send error message');
    }
  }
}

async function handleOnboardingFlow(whatsappId, user, messageText, messageId, startTime) {
  const result = await handleOnboarding(user, messageText);
  const response = result.response;
  const messageType = result.messageType;

  // React sparingly — only on first greeting and chart generation
  const step = user.onboarding_step || 'new';
  if (step === 'new') {
    reactToMessage(whatsappId, messageId, '🙏').catch(() => {});
  } else if (result.messageType === 'reading') {
    reactToMessage(whatsappId, messageId, '🌟').catch(() => {});
  }

  const delay = calculateDelay(messageType, response.length);
  logger.info({ delayMs: delay, messageType }, 'Applying response delay');
  await sleep(delay);

  await showTyping(messageId);
  await sleep(500);

  // Use buttons for topic selection after greeting
  if (result.useButtons && result.buttons) {
    await sendButtonMessage(whatsappId, response, result.buttons);
  } else {
    await sendTextMessage(whatsappId, response);
  }

  // Save onboarding exchanges for debugging and dashboard
  try {
    const { conversationId } = await getSessionContext(user.id);
    await saveExchange(conversationId, user.id, messageText, response, {
      language: user.language || 'en',
      intent: 'onboarding_' + (user.onboarding_step || 'new'),
      model: 'none',
      responseTimeMs: Date.now() - startTime,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to save onboarding exchange');
  }

  // If chart was just generated, generate and send hook
  if (result.messageType === 'reading') {
    await sleep(2000);
    await showTyping(messageId);

    try {
      const chartData = typeof user.chart_data === 'string'
        ? JSON.parse(user.chart_data)
        : user.chart_data;

      const { getUserByWhatsAppId } = await import('../db/users.js');
      const freshUser = await getUserByWhatsAppId(whatsappId);
      const freshChart = freshUser?.chart_data
        ? (typeof freshUser.chart_data === 'string' ? JSON.parse(freshUser.chart_data) : freshUser.chart_data)
        : chartData;

      const lang = user.language || 'en';
      const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
      const hookScript = prefs.script || 'latin';
      const hook = await generateHook(freshChart, lang, hookScript);

      if (hook) {
        const hookDelay = calculateDelay('reading', hook.length);
        await sleep(hookDelay);

        const frame = t(lang, 'hook_frame');
        const suffix = t(lang, 'hook_suffix');
        const fullHook = frame + hook + suffix;
        await sendMultiPart(whatsappId, messageId, fullHook);

        await updateUser(freshUser?.id || user.id, { chart_summary: hook });

        // Send chart review link if token was generated
        if (result.reviewToken) {
          await sleep(1000);
          const baseUrl = process.env.APP_URL || 'https://tara-astro-production.up.railway.app';
          const chartUrl = `${baseUrl}/chart/${result.reviewToken}`;
          const chartLinkTexts = {
            hi: `Aapki poori kundli yahan dekhiye \uD83D\uDC47\n${chartUrl}`,
            ta: `Ungal muzhuma jaadhagam ingae paarunga \uD83D\uDC47\n${chartUrl}`,
            te: `Mee purthee kundali ikkada choodandi \uD83D\uDC47\n${chartUrl}`,
            bn: `Apnar purno kundali ekhane dekhun \uD83D\uDC47\n${chartUrl}`,
            ml: `Ningalude poorna jathakam ividey kaanuka \uD83D\uDC47\n${chartUrl}`,
            kn: `Nimma purna kundali illi noodi \uD83D\uDC47\n${chartUrl}`,
            en: `View your full birth chart here \uD83D\uDC47\n${chartUrl}`,
          };
          const chartLinkMsg = chartLinkTexts[lang] || chartLinkTexts.hi;
          await sendTextMessage(whatsappId, chartLinkMsg);
        }

        // Send topic buttons after hook
        await sleep(1500);
        const postButtons = getPostChartButtons(lang);
        const buttonText = t(lang, 'post_chart_prompt');
        await sendButtonMessage(whatsappId, buttonText, postButtons);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Hook generation failed, continuing without hook');
    }
  }

  logger.info({ responseTimeMs: Date.now() - startTime }, 'Onboarding message processed');
}

async function handleHookFlow(whatsappId, user, messageText, messageId, startTime) {
  if (!user.chart_summary) {
    await updateUser(user.id, { chart_summary: 'acknowledged' });
  }
  await handleAIConversation(whatsappId, user, messageText, messageId, startTime);
}

async function handleAIConversation(whatsappId, user, messageText, messageId, startTime) {
  const lang = user.language || 'en';

  const { conversationId, history } = await getSessionContext(user.id);

  // Multi-agent dispatch
  const result = await dispatchToAgent(messageText, user, history);
  logger.info({ agent: result.agent, model: result.model, tokenBudget: result.tokenBudget }, 'Agent dispatched');

  // Gate/crisis responses — send immediately
  if (result.agent === AGENTS.GATE || result.agent === AGENTS.CRISIS) {
    await sendTextMessage(whatsappId, result.text);
    await saveExchange(conversationId, user.id, messageText, result.text, {
      language: lang,
      intent: result.intent,
      model: result.model,
      responseTimeMs: result.responseTimeMs,
    });
    return;
  }

  // Apply human-like delay
  const isComplex = [AGENTS.READING, AGENTS.REMEDY].includes(result.agent);
  const delay = calculateDelay(isComplex ? 'complex' : 'simple', result.text.length);
  logger.info({ delayMs: delay, agent: result.agent }, 'Applying response delay');
  await sleep(delay);

  // Show typing before response
  await showTyping(messageId);

  // Send response
  await sendWithThinking(whatsappId, messageId, result.text, lang, isComplex);

  // Save exchange
  await saveExchange(conversationId, user.id, messageText, result.text, {
    language: lang,
    intent: result.intent,
    model: result.model,
    responseTimeMs: result.responseTimeMs,
  });

  logger.info({
    userId: user.id,
    responseTimeMs: Date.now() - startTime,
    agent: result.agent,
    model: result.model,
  }, 'Agent message processed');
}
