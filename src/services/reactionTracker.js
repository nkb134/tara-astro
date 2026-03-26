/**
 * Reaction Tracker — stores user reactions as implicit feedback.
 *
 * Positive: ❤️ 👍 🔥 ✨ 🙏 😊 💯 👏 🤩 💪
 * Negative: 👎 😡 😕 😤 🤦 💔 😒
 * Neutral: 😂 🤔 😮 😱 (informational)
 */
import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const POSITIVE = new Set(['❤️', '👍', '🔥', '✨', '🙏', '😊', '💯', '👏', '🤩', '💪', '❤', '🙌', '💖', '💕']);
const NEGATIVE = new Set(['👎', '😡', '😕', '😤', '🤦', '💔', '😒', '🤮', '💩']);

function classifyEmoji(emoji) {
  if (POSITIVE.has(emoji)) return 'positive';
  if (NEGATIVE.has(emoji)) return 'negative';
  return 'neutral';
}

export async function storeReaction(whatsappId, reactedToMessageId, emoji) {
  const sentiment = classifyEmoji(emoji);

  try {
    // Find the message that was reacted to by its WA message ID
    const msgResult = await query(
      `SELECT m.id, m.content, m.role, m.user_id, m.intent, m.model_used
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE u.whatsapp_id = $1 AND m.wa_message_id = $2
       LIMIT 1`,
      [whatsappId, reactedToMessageId]
    );

    if (msgResult.rows.length === 0) {
      // WA message ID not found — might be an older message before we started tracking
      logger.info({ whatsappId, emoji, sentiment, reactedToMessageId }, 'Reaction received (message not in DB)');
      return;
    }

    const msg = msgResult.rows[0];

    // Store reaction in a simple format — add to messages table as metadata
    // For now, log it and update a reactions counter
    await query(
      `INSERT INTO reactions (user_id, message_id, emoji, sentiment, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, message_id) DO UPDATE SET emoji = $3, sentiment = $4, created_at = NOW()`,
      [msg.user_id, msg.id, emoji, sentiment]
    ).catch(async () => {
      // Table might not exist yet — create it
      await query(`
        CREATE TABLE IF NOT EXISTS reactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          message_id INTEGER REFERENCES messages(id),
          emoji VARCHAR(10),
          sentiment VARCHAR(10),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, message_id)
        )
      `);
      await query(
        `INSERT INTO reactions (user_id, message_id, emoji, sentiment, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, message_id) DO UPDATE SET emoji = $3, sentiment = $4, created_at = NOW()`,
        [msg.user_id, msg.id, emoji, sentiment]
      );
    });

    logger.info({
      whatsappId, emoji, sentiment,
      messageRole: msg.role,
      messageIntent: msg.intent,
      messageModel: msg.model_used,
    }, 'Reaction stored');

  } catch (err) {
    logger.error({ err: err.message, whatsappId, emoji }, 'Failed to store reaction');
  }
}

// Get reaction summary for QA audit
export async function getReactionSummary() {
  try {
    const result = await query(`
      SELECT
        sentiment,
        COUNT(*) as count,
        array_agg(DISTINCT emoji) as emojis
      FROM reactions
      GROUP BY sentiment
      ORDER BY count DESC
    `);
    return result.rows;
  } catch {
    return [];
  }
}

// Get negative reactions for review
export async function getNegativeReactions(limit = 20) {
  try {
    const result = await query(`
      SELECT r.emoji, r.created_at, m.content as tara_message, m.intent, m.model_used,
             u.display_name, u.whatsapp_id
      FROM reactions r
      JOIN messages m ON r.message_id = m.id
      JOIN users u ON r.user_id = u.id
      WHERE r.sentiment = 'negative'
      ORDER BY r.created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch {
    return [];
  }
}
