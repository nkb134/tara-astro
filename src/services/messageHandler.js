import { findOrCreateUser, updateUser } from '../db/users.js';
import { sendTextMessage, showTyping, markAsRead } from '../whatsapp/sender.js';
import { handleOnboarding } from './onboardingHandler.js';
import { getSessionContext, saveExchange } from './sessionManager.js';
import { classifyIntent } from '../ai/classifier.js';
import { generateResponse, generateHook } from '../ai/responder.js';
import { calculateDelay, sleep } from '../utils/delay.js';
import { detectLanguage, isLanguageNeutral, t } from '../languages/index.js';
import { logger } from '../utils/logger.js';

// Thinking simulation: send a short thinking phrase before complex responses
async function sendWithThinking(whatsappId, responseText, lang, isComplex) {
  if (!isComplex) {
    await sendTextMessage(whatsappId, responseText);
    return;
  }

  // Get thinking phrases from language file
  const thinkingPhrases = t(lang, 'thinking_phrases');
  let phrase = 'Hmm...';
  if (Array.isArray(thinkingPhrases)) {
    phrase = thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)];
  }

  // Send thinking phrase first
  await sendTextMessage(whatsappId, phrase);

  // Wait 3-5 seconds (simulating thinking)
  await sleep(3000 + Math.random() * 2000);

  // Send actual response
  await sendTextMessage(whatsappId, responseText);
}

export async function handleIncomingMessage(whatsappId, displayName, messageText, messageId) {
  const startTime = Date.now();

  try {
    // Step 1: Immediately mark as read (blue ticks)
    await markAsRead(messageId);

    // Step 2: Show typing indicator
    await showTyping(whatsappId);

    // Step 3: Find or create user
    const user = await findOrCreateUser(whatsappId, displayName);
    logger.info({ userId: user.id }, 'Processing message');

    // Language detection during onboarding is handled by onboardingHandler.js
    // (which correctly skips re-detection on neutral inputs like names/dates).
    // For post-onboarding messages, update language only if non-neutral and non-English detected.
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

    // Step 4: Route to appropriate handler
    if (!user.is_onboarded) {
      await handleOnboardingFlow(whatsappId, user, messageText, startTime);
      return;
    }

    // Step 5: Handle post-onboarding hook
    if (user.is_onboarded && !user.chart_summary && user.chart_data) {
      await handleHookFlow(whatsappId, user, messageText, startTime);
      return;
    }

    // Step 6: Regular AI conversation
    await handleAIConversation(whatsappId, user, messageText, messageId, startTime);
  } catch (err) {
    logger.error({ err, whatsappId }, 'Failed to handle message');
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

  // Apply delay
  const delay = calculateDelay(messageType, response.length);
  logger.info({ delayMs: delay, messageType }, 'Applying response delay');
  await sleep(delay);

  await showTyping(whatsappId);
  await sleep(500);
  await sendTextMessage(whatsappId, response);

  // If chart was just generated, generate and send hook
  // Note: use result.chartData (returned by generateChartFromPlace) or re-fetch from DB
  if (result.messageType === 'reading') {
    await sleep(2000);
    await showTyping(whatsappId);

    try {
      const chartData = typeof user.chart_data === 'string'
        ? JSON.parse(user.chart_data)
        : user.chart_data;

      // Re-fetch user to get updated chart_data
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

        // Use thinking simulation for hook delivery
        const frame = t(lang, 'hook_frame');
        const suffix = t(lang, 'hook_suffix');
        const fullHook = frame + hook + suffix;
        await sendWithThinking(whatsappId, fullHook, lang, true);

        // Save hook as chart_summary so we don't regenerate
        await updateUser(freshUser?.id || user.id, { chart_summary: hook });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Hook generation failed, continuing without hook');
    }
  }

  logger.info({ responseTimeMs: Date.now() - startTime }, 'Onboarding message processed');
}

async function handleHookFlow(whatsappId, user, messageText, startTime) {
  // User responded to hook — now show chart overview and continue to AI conversation
  // Mark that hook has been acknowledged by setting chart_summary
  if (!user.chart_summary) {
    await updateUser(user.id, { chart_summary: 'acknowledged' });
  }

  // Proceed to AI conversation
  await handleAIConversation(whatsappId, user, messageText, null, startTime);
}

async function handleAIConversation(whatsappId, user, messageText, messageId, startTime) {
  const lang = user.language || 'en';

  // Get session context (conversation history)
  const { conversationId, history } = await getSessionContext(user.id);

  // Classify intent
  const classification = await classifyIntent(messageText, lang);
  logger.info({ intent: classification.intent, complexity: classification.complexity }, 'Intent classified');

  // Handle special intents
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

  // Use thinking simulation for complex responses (readings, remedies)
  const isComplex = classification.complexity === 'complex' ||
    ['career_reading', 'relationship_reading', 'remedy_request', 'kundli_overview'].includes(classification.intent);
  await sendWithThinking(whatsappId, result.text, lang, isComplex);

  // Save exchange to database
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
