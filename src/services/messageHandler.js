import { findOrCreateUser } from '../db/users.js';
import { sendTextMessage } from '../whatsapp/sender.js';
import { logger } from '../utils/logger.js';

export async function handleIncomingMessage(whatsappId, displayName, messageText) {
  const startTime = Date.now();

  try {
    // Step 1: Find or create user
    const user = await findOrCreateUser(whatsappId, displayName);
    logger.info({ userId: user.id, whatsappId }, 'Processing message');

    // Phase 1: Echo the message back
    const echoText = `Namaste! I'm Tara, your Jyotish companion. You said: "${messageText}"

(Phase 1 echo mode — full features coming soon!)`;

    await sendTextMessage(whatsappId, echoText);

    const elapsed = Date.now() - startTime;
    logger.info({ userId: user.id, responseTimeMs: elapsed }, 'Message processed');
  } catch (err) {
    logger.error({ err, whatsappId }, 'Failed to handle message');

    // Try to send error message to user
    try {
      await sendTextMessage(
        whatsappId,
        'Sorry, I encountered an error. Please try again in a moment.'
      );
    } catch {
      // If we can't even send the error message, just log it
      logger.error({ whatsappId }, 'Failed to send error message to user');
    }
  }
}
