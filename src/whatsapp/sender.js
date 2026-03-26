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
  let lastWaMessageId = null;

  for (let i = 0; i < chunks.length; i++) {
    // Small pause between overflow splits (rare — only for very long messages)
    if (i > 0) {
      await sleep(1000 + Math.random() * 1000);
    }
    const data = await sendSingleMessage(to, chunks[i]);
    lastWaMessageId = data?.messages?.[0]?.id || null;
  }
  return lastWaMessageId;
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

// React to a user's message with an emoji
export async function reactToMessage(to, messageId, emoji) {
  if (!messageId) return;
  try {
    await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    });
  } catch {
    logger.debug({ messageId, emoji }, 'Reaction failed (best-effort)');
  }
}

// Send interactive quick reply buttons (max 3 buttons)
export async function sendButtonMessage(to, bodyText, buttons) {
  try {
    const response = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((btn, i) => ({
            type: 'reply',
            reply: {
              id: btn.id || `btn_${i}`,
              title: btn.title.substring(0, 20), // WhatsApp max 20 chars
            },
          })),
        },
      },
    });
    logger.debug({ to }, 'Button message sent');
    return response.data;
  } catch (err) {
    logger.error({ to, error: err.response?.data || err.message }, 'Failed to send button message');
    // Fallback to text if buttons fail
    await sendTextMessage(to, bodyText);
  }
}

// Send interactive list message (for more than 3 options)
export async function sendListMessage(to, bodyText, buttonText, sections) {
  try {
    const response = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText.substring(0, 20),
          sections: sections.map(s => ({
            title: s.title,
            rows: s.rows.map(r => ({
              id: r.id,
              title: r.title.substring(0, 24),
              description: r.description?.substring(0, 72),
            })),
          })),
        },
      },
    });
    logger.debug({ to }, 'List message sent');
    return response.data;
  } catch (err) {
    logger.error({ to, error: err.response?.data || err.message }, 'Failed to send list message');
    await sendTextMessage(to, bodyText);
  }
}

// Send image as PNG buffer via WhatsApp Media API
export async function sendImageMessage(to, imageBuffer, caption = '') {
  try {
    // Step 1: Upload media to WhatsApp
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', imageBuffer, {
      filename: 'kundli.png',
      contentType: 'image/png',
    });
    form.append('type', 'image/png');

    const uploadResponse = await axios.post(
      `${WHATSAPP_API_URL}/${config.whatsapp.phoneNumberId}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${config.whatsapp.apiToken}`,
        },
      }
    );

    const mediaId = uploadResponse.data?.id;
    if (!mediaId) {
      logger.error('Media upload returned no ID');
      return null;
    }

    // Step 2: Send image message with media ID
    const response = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: {
        id: mediaId,
        caption: caption || undefined,
      },
    });

    const waMessageId = response.data?.messages?.[0]?.id || null;
    logger.info({ to, mediaId, waMessageId }, 'Image message sent');
    return waMessageId;
  } catch (err) {
    logger.error({ to, error: err.response?.data || err.message }, 'Failed to send image message');
    return null;
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
