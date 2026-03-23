import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { handleIncomingMessage } from '../services/messageHandler.js';
import { markAsRead } from './sender.js';

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
          // Only handle text messages for now
          if (message.type !== 'text') {
            logger.debug({ type: message.type }, 'Ignoring non-text message');
            continue;
          }

          const whatsappId = message.from;
          const contactName = contacts.find(c => c.wa_id === whatsappId)?.profile?.name || '';
          const messageText = message.text?.body || '';
          const messageId = message.id;

          logger.info({ whatsappId, messageId }, 'Incoming message');

          // Mark as read
          markAsRead(messageId).catch(() => {});

          // Process message (don't await — already responded 200)
          handleIncomingMessage(whatsappId, contactName, messageText).catch(err => {
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
