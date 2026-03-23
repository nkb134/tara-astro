import { query } from './connection.js';
import { logger } from '../utils/logger.js';

export async function getOrCreateConversation(userId, sessionId = null) {
  // Find active conversation (last message within 30 minutes)
  const existing = await query(
    `SELECT * FROM conversations
     WHERE user_id = $1 AND is_active = TRUE
       AND last_message_at > NOW() - INTERVAL '30 minutes'
     ORDER BY last_message_at DESC LIMIT 1`,
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Deactivate old conversations
  await query(
    `UPDATE conversations SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );

  // Create new conversation
  const result = await query(
    `INSERT INTO conversations (user_id, session_id, started_at, last_message_at, is_active, message_count)
     VALUES ($1, $2, NOW(), NOW(), TRUE, 0)
     RETURNING *`,
    [userId, sessionId]
  );

  logger.info({ userId, conversationId: result.rows[0]?.id }, 'New conversation created');
  return result.rows[0];
}

export async function saveMessage(conversationId, userId, role, content, metadata = {}) {
  const result = await query(
    `INSERT INTO messages (conversation_id, user_id, role, content, language, intent, model_used, response_time_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING *`,
    [
      conversationId, userId, role, content,
      metadata.language || null,
      metadata.intent || null,
      metadata.model || null,
      metadata.responseTimeMs || null,
    ]
  );

  // Update conversation
  await query(
    `UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE id = $1`,
    [conversationId]
  );

  return result.rows[0];
}

export async function getRecentMessages(conversationId, limit = 6) {
  const result = await query(
    `SELECT role, content, language, intent, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );

  // Return in chronological order
  return result.rows.reverse();
}
