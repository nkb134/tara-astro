import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// ── Auto-create chart_validations table on first use ──────────────────

let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS chart_validations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        planet_validations JSONB DEFAULT '{}'::jsonb,
        overall_rating SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
        notes TEXT,
        reviewer_name VARCHAR(100) DEFAULT 'Expert',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_chart_validations_user
      ON chart_validations(user_id)
    `);
    tablesReady = true;
    logger.info('chart_validations table ready');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to create chart_validations table');
    throw err;
  }
}

// ── Generate review token ────────────────────────────────────────────
// Creates a short 8-char hex token linked to user, stored in preferences JSONB

export async function generateReviewToken(userId) {
  const token = crypto.randomBytes(4).toString('hex'); // 8 hex chars

  // Store token in user preferences
  const userResult = await query('SELECT preferences FROM users WHERE id = $1', [userId]);
  const currentPrefs = userResult.rows[0]?.preferences || {};
  const prefs = typeof currentPrefs === 'string' ? JSON.parse(currentPrefs) : currentPrefs;

  prefs.reviewToken = token;
  prefs.reviewTokenCreatedAt = new Date().toISOString();

  await query(
    'UPDATE users SET preferences = $2 WHERE id = $1',
    [userId, JSON.stringify(prefs)]
  );

  logger.info({ userId, tokenLength: token.length }, 'Chart review token generated');
  return token;
}

// ── Get user by review token ─────────────────────────────────────────

export async function getUserByToken(token) {
  if (!token || token.length !== 8) return null;

  // Search for user with matching token in preferences JSONB
  const result = await query(
    `SELECT * FROM users WHERE preferences->>'reviewToken' = $1`,
    [token]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  // Parse chart_data if it's a string
  if (user.chart_data && typeof user.chart_data === 'string') {
    try {
      user.chart_data = JSON.parse(user.chart_data);
    } catch {
      // leave as-is
    }
  }

  return user;
}

// ── Get all readings for a user ──────────────────────────────────────

export async function getReadingsForUser(userId) {
  const result = await query(`
    SELECT
      m.id AS message_id,
      m.content,
      m.role,
      m.intent,
      m.model_used,
      m.rag_sources,
      m.response_time_ms,
      m.created_at,
      -- Get the user question that triggered this reading (for assistant messages)
      CASE WHEN m.role = 'assistant' THEN (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND role = 'user'
          AND created_at < m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) END AS user_question,
      -- Check if feedback already exists
      (
        SELECT json_build_object(
          'id', ef.id,
          'accuracy_rating', ef.accuracy_rating,
          'advice_rating', ef.advice_rating,
          'tone_rating', ef.tone_rating,
          'correction_text', ef.correction_text
        )
        FROM expert_feedback ef
        WHERE ef.message_id = m.id
        ORDER BY ef.created_at DESC
        LIMIT 1
      ) AS existing_feedback
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.user_id = $1
      AND m.role = 'assistant'
      AND m.intent IS NOT NULL
      AND m.intent != 'onboarding_new'
    ORDER BY m.created_at ASC
  `, [userId]);

  return result.rows.map(row => ({
    messageId: row.message_id,
    content: row.content,
    role: row.role,
    intent: row.intent,
    modelUsed: row.model_used,
    ragSources: row.rag_sources,
    responseTimeMs: row.response_time_ms,
    createdAt: row.created_at,
    userQuestion: row.user_question,
    existingFeedback: row.existing_feedback || null,
  }));
}

// ── Submit chart validation ──────────────────────────────────────────

export async function submitChartValidation(userId, validation) {
  await ensureTables();

  const {
    planetValidations = {},
    overallRating,
    notes = '',
    reviewerName = 'Expert',
  } = validation;

  if (overallRating !== undefined && overallRating !== null && (overallRating < 1 || overallRating > 5)) {
    throw new Error('overallRating must be between 1 and 5');
  }

  const result = await query(`
    INSERT INTO chart_validations (user_id, planet_validations, overall_rating, notes, reviewer_name)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    userId,
    JSON.stringify(planetValidations),
    overallRating || null,
    notes,
    reviewerName,
  ]);

  logger.info({ userId, overallRating }, 'Chart validation submitted');
  return result.rows[0];
}

// ── Submit reading feedback (reuses expert_feedback table) ───────────

export async function submitReadingFeedback(messageId, feedback) {
  // Reuse the existing expert_feedback table and ensure it exists
  const { submitFeedback } = await import('./expertService.js');
  return submitFeedback(messageId, feedback);
}
