import { query } from './connection.js';
import { logger } from '../utils/logger.js';

export async function findOrCreateUser(whatsappId, displayName) {
  // Try to find existing user
  const existing = await query(
    'SELECT * FROM users WHERE whatsapp_id = $1',
    [whatsappId]
  );

  if (existing.rows.length > 0) {
    // Update last_active_at
    await query(
      'UPDATE users SET last_active_at = NOW() WHERE id = $1',
      [existing.rows[0].id]
    );
    return existing.rows[0];
  }

  // Create new user
  const result = await query(
    `INSERT INTO users (whatsapp_id, display_name, language, onboarding_step)
     VALUES ($1, $2, 'en', 'new')
     RETURNING *`,
    [whatsappId, displayName || null]
  );

  logger.info({ userId: result.rows[0].id }, 'New user created');
  return result.rows[0];
}

export async function getUserByWhatsAppId(whatsappId) {
  const result = await query(
    'SELECT * FROM users WHERE whatsapp_id = $1',
    [whatsappId]
  );
  return result.rows[0] || null;
}

export async function updateUser(userId, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');

  const result = await query(
    `UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`,
    [userId, ...values]
  );
  return result.rows[0];
}
