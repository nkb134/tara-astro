import axios from 'axios';
import { config } from '../config/env.js';
import { WHATSAPP_API_URL, MAX_WHATSAPP_MESSAGE_LENGTH } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/delay.js';

const api = axios.create({
  baseURL: `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}`,
  headers: {
    Authorization: `Bearer ${config.whatsapp.apiToken}`,
    'Content-Type': 'application/json',
  },
});

export async function sendTextMessage(to, text) {
  const chunks = splitMessage(text);

  for (let i = 0; i < chunks.length; i++) {
    // Show typing between split messages
    if (i > 0) {
      await showTyping(to);
      await sleep(1000 + Math.random() * 1000); // 1-2s between splits
    }
    await sendSingleMessage(to, chunks[i]);
  }
}

async function sendSingleMessage(to, text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await api.post('/messages', {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      });
      logger.debug({ to, messageId: response.data?.messages?.[0]?.id }, 'Message sent');
      return response.data;
    } catch (err) {
      logger.error(
        { attempt, to, error: err.response?.data || err.message },
        'Failed to send WhatsApp message'
      );
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

function splitMessage(text) {
  if (text.length <= MAX_WHATSAPP_MESSAGE_LENGTH) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_WHATSAPP_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', MAX_WHATSAPP_MESSAGE_LENGTH);
    if (splitAt < MAX_WHATSAPP_MESSAGE_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(' ', MAX_WHATSAPP_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_WHATSAPP_MESSAGE_LENGTH / 2) {
      splitAt = MAX_WHATSAPP_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export async function markAsRead(messageId) {
  try {
    await api.post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (err) {
    logger.warn({ messageId, error: err.message }, 'Failed to mark as read');
  }
}

export async function showTyping(to) {
  try {
    await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      status: 'typing',
    });
  } catch {
    // Typing indicator is best-effort — don't fail on it
    logger.debug({ to }, 'Typing indicator not supported, using read receipt fallback');
  }
}
