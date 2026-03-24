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
    // Small pause between overflow splits (rare — only for very long messages)
    if (i > 0) {
      await sleep(1000 + Math.random() * 1000);
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

// Show "typing..." indicator to user (auto-dismisses after 25s or when we reply)
// Requires the inbound messageId — piggybacks on the read receipt API
export async function showTyping(messageId) {
  if (!messageId) return;
  try {
    await api.post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: {
        type: 'text',
      },
    });
  } catch {
    // Typing indicator is best-effort — don't fail on it
    logger.debug({ messageId }, 'Typing indicator failed (best-effort)');
  }
}
