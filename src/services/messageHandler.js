import { findOrCreateUser } from '../db/users.js';
import { sendTextMessage, showTyping, markAsRead } from '../whatsapp/sender.js';
import { handleOnboarding } from './onboardingHandler.js';
import { calculateDelay, sleep } from '../utils/delay.js';
import { t } from '../languages/index.js';
import { logger } from '../utils/logger.js';

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

    // Step 4: Determine response
    let response;
    let messageType = 'simple';

    if (!user.is_onboarded) {
      const result = await handleOnboarding(user, messageText);
      response = result.response;
      messageType = result.messageType;
    } else {
      // Echo mode for onboarded users (until Phase 3 AI is built)
      const lang = user.language || 'en';
      const name = user.display_name || 'friend';
      response = t(lang, 'echo_reply')
        .replace('{name}', name)
        .replace('{message}', messageText);
      messageType = 'simple';
    }

    // Step 5: Human-like thinking delay
    const delay = calculateDelay(messageType, response.length);
    await sleep(delay);

    // Step 6: Show typing again right before sending
    await showTyping(whatsappId);
    await sleep(500);

    // Step 7: Send response
    await sendTextMessage(whatsappId, response);

    const elapsed = Date.now() - startTime;
    logger.info({ userId: user.id, responseTimeMs: elapsed, messageType }, 'Message processed');
  } catch (err) {
    logger.error({ err, whatsappId }, 'Failed to handle message');

    try {
      await sendTextMessage(
        whatsappId,
        'Sorry, something went wrong on my end. Please try again in a moment.'
      );
    } catch {
      logger.error({ whatsappId }, 'Failed to send error message to user');
    }
  }
}
