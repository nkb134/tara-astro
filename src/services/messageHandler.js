import { findOrCreateUser, updateUser } from '../db/users.js';
import { sendTextMessage, showTyping, markAsRead } from '../whatsapp/sender.js';
import { handleOnboarding } from './onboardingHandler.js';
import { getSessionContext, saveExchange } from './sessionManager.js';
import { classifyIntent } from '../ai/classifier.js';
import { generateResponse, generateHook } from '../ai/responder.js';
import { calculateDelay, sleep } from '../utils/delay.js';
import { detectLanguage, isLanguageNeutral, t } from '../languages/index.js';
import { logger } from '../utils/logger.js';

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
// Collects rapid-fire messages into one batch (2.5s window)
const messageBuffers = new Map();

export async function handleIncomingMessage(whatsappId, displayName, messageText, messageId) {
  // Immediately mark as read and show typing (instant feedback)
  await markAsRead(messageId).catch(() => {});
  await showTyping(whatsappId).catch(() => {});

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
  }, 2500);
}

// Thinking simulation with cooldown (max once per 3 min per user)
const thinkingCooldowns = new Map();

async function sendWithThinking(whatsappId, responseText, lang, isComplex) {
  if (!isComplex) {
    await sendMultiPart(whatsappId, responseText);
    return;
  }

  const now = Date.now();
  const lastThinking = thinkingCooldowns.get(whatsappId) || 0;
  const shouldThink = now - lastThinking > 300000; // 5 min cooldown (was 3 min)

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

  await sendMultiPart(whatsappId, responseText);
}

// Split AI responses on --- delimiter into multiple WhatsApp messages (max 3)
async function sendMultiPart(whatsappId, text) {
  const parts = text.split(/\n---\n|^---\n|\n---$/gm)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Cap at 3 parts max — merge overflow into last part
  if (parts.length > 3) {
    const merged = parts.slice(2).join('\n\n');
    parts.length = 2;
    parts.push(merged);
  }

  if (parts.length <= 1) {
    await sendTextMessage(whatsappId, text);
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      await showTyping(whatsappId);
      await sleep(1500 + Math.random() * 1000);
    }
    await sendTextMessage(whatsappId, parts[i]);
  }
}

async function processMessage(whatsappId, displayName, messageText, messageId) {
  const startTime = Date.now();

  try {
    // Show typing (refresh since debounce delay may have expired it)
    await showTyping(whatsappId);

    // Find or create user
    const user = await findOrCreateUser(whatsappId, displayName);
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
        const detectedLang = detectLanguage(messageText);
        if (detectedLang !== 'en' && detectedLang !== user.language) {
          await updateUser(user.id, { language: detectedLang }).catch(err => {
            logger.warn({ err: err.message, userId: user.id }, 'Failed to persist language update');
          });
          user.language = detectedLang;
        }
      }
    }

    // Route to handler
    if (!user.is_onboarded) {
      await handleOnboardingFlow(whatsappId, user, messageText, startTime);
      return;
    }

    if (user.is_onboarded && !user.chart_summary && user.chart_data) {
      await handleHookFlow(whatsappId, user, messageText, startTime);
      return;
    }

    await handleAIConversation(whatsappId, user, messageText, messageId, startTime);
  } catch (err) {
    logger.error({ err, whatsappId }, 'Failed to handle message');
    // Don't spam errors — max once per 60s per user
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

async function handleOnboardingFlow(whatsappId, user, messageText, startTime) {
  const result = await handleOnboarding(user, messageText);
  const response = result.response;
  const messageType = result.messageType;

  const delay = calculateDelay(messageType, response.length);
  logger.info({ delayMs: delay, messageType }, 'Applying response delay');
  await sleep(delay);

  await showTyping(whatsappId);
  await sleep(500);
  await sendTextMessage(whatsappId, response);

  // If chart was just generated, generate and send hook
  if (result.messageType === 'reading') {
    await sleep(2000);
    await showTyping(whatsappId);

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
      const hook = await generateHook(freshChart, lang);

      if (hook) {
        const hookDelay = calculateDelay('reading', hook.length);
        await sleep(hookDelay);

        const frame = t(lang, 'hook_frame');
        const suffix = t(lang, 'hook_suffix');
        const fullHook = frame + hook + suffix;
        // Skip thinking phrase for hook — hook_frame already acts as preamble
        await sendMultiPart(whatsappId, fullHook);

        await updateUser(freshUser?.id || user.id, { chart_summary: hook });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Hook generation failed, continuing without hook');
    }
  }

  logger.info({ responseTimeMs: Date.now() - startTime }, 'Onboarding message processed');
}

async function handleHookFlow(whatsappId, user, messageText, startTime) {
  if (!user.chart_summary) {
    await updateUser(user.id, { chart_summary: 'acknowledged' });
  }
  await handleAIConversation(whatsappId, user, messageText, null, startTime);
}

async function handleAIConversation(whatsappId, user, messageText, messageId, startTime) {
  const lang = user.language || 'en';

  const { conversationId, history } = await getSessionContext(user.id);

  const classification = await classifyIntent(messageText, lang);
  logger.info({ intent: classification.intent, complexity: classification.complexity }, 'Intent classified');

  // Crisis handling — double-check with keyword guard to prevent false positives
  const crisisKeywords = /\b(suicide|suicid|marr?na|khatam kar|end.?life|jeena nahi|marna chahta|aatmahatya|die|kill myself|kill me|zindagi khatam|jaan de|khudkhushi)\b/i;
  if (classification.intent === 'crisis' && !crisisKeywords.test(messageText)) {
    logger.info({ messageText: '[redacted]' }, 'Crisis downgraded — no crisis keywords found');
    classification.intent = 'career_reading';
    classification.complexity = 'complex';
  }

  if (classification.intent === 'crisis') {
    const crisisResponses = {
      hi: 'Main samajh sakti hoon. Kripya apne kareeb kisi se baat karein. Madad ke liye iCall helpline: 9152987821 par call karein. Main aapke saath hoon.',
      ta: 'Naan purinjukiren. Thayavu seidhu ungal arugil irukkum oruvaridham pesavum. iCall helpline: 9152987821. Naan ungalukku irukkiren.',
      en: 'I hear you. Please reach out to someone close to you, or call iCall helpline: 9152987821. I\'m here for you.',
    };
    const response = crisisResponses[lang] || crisisResponses.en;
    await sleep(calculateDelay('simple', response.length));
    await showTyping(whatsappId);
    await sleep(500);
    await sendTextMessage(whatsappId, response);
    await saveExchange(conversationId, user.id, messageText, response, { language: lang, intent: 'crisis' });
    return;
  }

  // Generate AI response
  const result = await generateResponse(messageText, user, classification, history);

  // Apply human-like delay
  const delay = calculateDelay(classification.complexity, result.text.length);
  logger.info({ delayMs: delay, intent: classification.intent }, 'Applying response delay');
  await sleep(delay);

  // Send (with thinking for complex, multi-part splitting for ---)
  const isComplex = classification.complexity === 'complex' ||
    ['career_reading', 'relationship_reading', 'remedy_request', 'kundli_overview'].includes(classification.intent);
  await sendWithThinking(whatsappId, result.text, lang, isComplex);

  // Save exchange
  await saveExchange(conversationId, user.id, messageText, result.text, {
    language: lang,
    intent: classification.intent,
    model: result.model,
    responseTimeMs: result.responseTimeMs,
  });

  logger.info({
    userId: user.id,
    responseTimeMs: Date.now() - startTime,
    intent: classification.intent,
    model: result.model,
  }, 'AI message processed');
}
