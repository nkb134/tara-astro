import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { handleIncomingMessage } from '../services/messageHandler.js';

// GET /webhook — Meta verification
export function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn({ mode, token }, 'Webhook verification failed');
  return res.sendStatus(403);
}

// POST /webhook — Incoming messages
export async function receiveMessage(req, res) {
  // Respond immediately to avoid Meta timeout
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const message of messages) {
          const whatsappId = message.from;
          const contactName = contacts.find(c => c.wa_id === whatsappId)?.profile?.name || '';
          const messageId = message.id;
          let messageText = '';

          // Extract quoted message context (when user replies to a specific message)
          let quotedContext = null;
          if (message.context) {
            const quotedMsgId = message.context.id;
            if (quotedMsgId) {
              logger.info({ whatsappId, quotedMsgId }, 'Message is a reply to another message');
              quotedContext = { quotedMessageId: quotedMsgId };
            }
          }

          // Handle text messages
          if (message.type === 'text') {
            messageText = message.text?.body || '';
          }
          // Handle interactive button replies
          else if (message.type === 'interactive') {
            const interactive = message.interactive;
            if (interactive?.type === 'button_reply') {
              messageText = interactive.button_reply?.title || '';
              logger.info({ whatsappId, buttonId: interactive.button_reply?.id }, 'Button reply received');
            } else if (interactive?.type === 'list_reply') {
              messageText = interactive.list_reply?.title || '';
              logger.info({ whatsappId, listId: interactive.list_reply?.id }, 'List reply received');
            }
          }
          // Unsupported types — tell user we only handle text for now
          else {
            const unsupportedTypes = ['audio', 'voice', 'image', 'video', 'document', 'sticker', 'location', 'contacts'];
            if (unsupportedTypes.includes(message.type)) {
              logger.info({ whatsappId, type: message.type }, 'Unsupported message type received');
              // Import lazily to avoid circular deps
              const { handleUnsupportedType } = await import('../services/messageHandler.js');
              handleUnsupportedType(whatsappId, message.type, message.id).catch(err => {
                logger.error({ err, whatsappId }, 'Error handling unsupported type');
              });
            } else {
              logger.debug({ type: message.type }, 'Ignoring unknown message type');
            }
            continue;
          }

          if (!messageText) continue;

          logger.info({ whatsappId, messageId }, 'Incoming message');

          // Process message (don't await — already responded 200)
          // markAsRead is now handled inside messageHandler
          handleIncomingMessage(whatsappId, contactName, messageText, messageId, quotedContext).catch(err => {
            logger.error({ err, whatsappId }, 'Error handling message');
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error processing webhook payload');
  }
}

// Middleware: Verify Meta signature
export function verifySignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    logger.warn('Missing x-hub-signature-256 header');
    return;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(buf)
    .digest('hex');

  if (signature !== expectedSignature) {
    logger.warn('Invalid webhook signature');
    throw new Error('Invalid signature');
  }
}
