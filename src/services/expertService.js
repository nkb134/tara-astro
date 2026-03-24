import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

// ── Auto-create expert_feedback table on first use ──────────────────

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS expert_feedback (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id),
        accuracy_rating SMALLINT CHECK (accuracy_rating BETWEEN 1 AND 5),
        advice_rating SMALLINT CHECK (advice_rating BETWEEN 1 AND 5),
        tone_rating SMALLINT CHECK (tone_rating BETWEEN 1 AND 5),
        flags JSONB DEFAULT '[]'::jsonb,
        correction_text TEXT,
        reviewer_name VARCHAR(100) DEFAULT 'Expert',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_expert_feedback_message
      ON expert_feedback(message_id)
    `);
    tableReady = true;
    logger.info('expert_feedback table ready');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to create expert_feedback table');
    throw err;
  }
}

// ── Get readings for review ─────────────────────────────────────────
// Fetches assistant messages that are readings/remedies with chart context

export async function getReadingsForReview(page = 1, limit = 20) {
  await ensureTable();

  const offset = (page - 1) * limit;

  // Get readings: assistant messages with reading/remedy intent using pro/flash models
  const result = await query(`
    SELECT
      m.id AS message_id,
      m.content AS reading_text,
      m.intent,
      m.model_used,
      m.rag_sources,
      m.chart_context_used,
      m.response_time_ms,
      m.created_at AS reading_at,
      m.conversation_id,
      u.display_name,
      u.birth_date,
      u.birth_time,
      u.birth_time_known,
      u.birth_place,
      u.chart_data,
      u.chart_summary,
      u.language,
      -- Get the user question that triggered this reading
      (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND role = 'user'
          AND created_at < m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) AS user_question,
      -- Check if feedback already exists
      (
        SELECT json_build_object(
          'id', ef.id,
          'accuracy_rating', ef.accuracy_rating,
          'advice_rating', ef.advice_rating,
          'tone_rating', ef.tone_rating,
          'flags', ef.flags,
          'correction_text', ef.correction_text,
          'reviewer_name', ef.reviewer_name,
          'created_at', ef.created_at
        )
        FROM expert_feedback ef
        WHERE ef.message_id = m.id
        ORDER BY ef.created_at DESC
        LIMIT 1
      ) AS existing_feedback
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.role = 'assistant'
      AND (m.intent ILIKE '%reading%' OR m.intent ILIKE '%remedy%' OR m.intent ILIKE '%prediction%')
      AND (m.model_used IN ('pro', 'flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'))
    ORDER BY m.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  // Get total count for pagination
  const countResult = await query(`
    SELECT COUNT(*) AS total
    FROM messages m
    WHERE m.role = 'assistant'
      AND (m.intent ILIKE '%reading%' OR m.intent ILIKE '%remedy%' OR m.intent ILIKE '%prediction%')
      AND (m.model_used IN ('pro', 'flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'))
  `);

  const total = parseInt(countResult.rows[0]?.total || 0);

  // Anonymize: first name only
  const readings = result.rows.map(row => ({
    messageId: row.message_id,
    readingText: row.reading_text,
    intent: row.intent,
    modelUsed: row.model_used,
    ragSources: row.rag_sources,
    chartContextUsed: row.chart_context_used,
    responseTimeMs: row.response_time_ms,
    readingAt: row.reading_at,
    conversationId: row.conversation_id,
    user: {
      firstName: (row.display_name || 'Anonymous').split(' ')[0],
      birthDate: row.birth_date,
      birthTime: row.birth_time,
      birthTimeKnown: row.birth_time_known,
      birthPlace: row.birth_place,
      language: row.language,
    },
    chartData: row.chart_data || null,
    chartSummary: row.chart_summary || null,
    userQuestion: row.user_question,
    existingFeedback: row.existing_feedback || null,
  }));

  return { readings, total, page, limit };
}

// ── Submit expert feedback ──────────────────────────────────────────

export async function submitFeedback(messageId, feedback) {
  await ensureTable();

  const {
    accuracyRating,
    adviceRating,
    toneRating,
    flags = [],
    correctionText = '',
    reviewerName = 'Expert',
  } = feedback;

  // Validate ratings
  for (const [name, val] of Object.entries({ accuracyRating, adviceRating, toneRating })) {
    if (val !== undefined && val !== null && (val < 1 || val > 5)) {
      throw new Error(`${name} must be between 1 and 5`);
    }
  }

  // Check message exists
  const msgCheck = await query('SELECT id FROM messages WHERE id = $1', [messageId]);
  if (msgCheck.rows.length === 0) {
    throw new Error(`Message ${messageId} not found`);
  }

  const result = await query(`
    INSERT INTO expert_feedback (message_id, accuracy_rating, advice_rating, tone_rating, flags, correction_text, reviewer_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    messageId,
    accuracyRating || null,
    adviceRating || null,
    toneRating || null,
    JSON.stringify(flags),
    correctionText,
    reviewerName,
  ]);

  logger.info({ messageId, accuracyRating, adviceRating, toneRating }, 'Expert feedback submitted');
  return result.rows[0];
}

// ── Get feedback statistics ─────────────────────────────────────────

export async function getFeedbackStats() {
  await ensureTable();

  const result = await query(`
    SELECT
      COUNT(*) AS total_reviews,
      COUNT(DISTINCT message_id) AS unique_readings_reviewed,
      ROUND(AVG(accuracy_rating)::numeric, 2) AS avg_accuracy,
      ROUND(AVG(advice_rating)::numeric, 2) AS avg_advice,
      ROUND(AVG(tone_rating)::numeric, 2) AS avg_tone,
      ROUND(((AVG(accuracy_rating) + AVG(advice_rating) + AVG(tone_rating)) / 3)::numeric, 2) AS avg_overall,
      COUNT(*) FILTER (WHERE flags::text LIKE '%Good reading%') AS good_readings,
      COUNT(*) FILTER (WHERE flags::text LIKE '%Wrong planet%') AS wrong_planet,
      COUNT(*) FILTER (WHERE flags::text LIKE '%Wrong dasha%') AS wrong_dasha,
      COUNT(*) FILTER (WHERE flags::text LIKE '%Wrong yoga%') AS wrong_yoga,
      COUNT(*) FILTER (WHERE flags::text LIKE '%Incorrect remedy%') AS incorrect_remedy,
      COUNT(*) FILTER (WHERE correction_text IS NOT NULL AND correction_text != '') AS corrections_submitted
    FROM expert_feedback
  `);

  const stats = result.rows[0] || {};

  // Rating distribution
  const distResult = await query(`
    SELECT
      accuracy_rating AS rating,
      COUNT(*) AS count
    FROM expert_feedback
    WHERE accuracy_rating IS NOT NULL
    GROUP BY accuracy_rating
    ORDER BY accuracy_rating
  `);

  const ratingDistribution = {};
  for (const row of distResult.rows) {
    ratingDistribution[row.rating] = parseInt(row.count);
  }

  return {
    totalReviews: parseInt(stats.total_reviews || 0),
    uniqueReadingsReviewed: parseInt(stats.unique_readings_reviewed || 0),
    avgAccuracy: parseFloat(stats.avg_accuracy || 0),
    avgAdvice: parseFloat(stats.avg_advice || 0),
    avgTone: parseFloat(stats.avg_tone || 0),
    avgOverall: parseFloat(stats.avg_overall || 0),
    goodReadings: parseInt(stats.good_readings || 0),
    wrongPlanet: parseInt(stats.wrong_planet || 0),
    wrongDasha: parseInt(stats.wrong_dasha || 0),
    wrongYoga: parseInt(stats.wrong_yoga || 0),
    incorrectRemedy: parseInt(stats.incorrect_remedy || 0),
    correctionsSubmitted: parseInt(stats.corrections_submitted || 0),
    ratingDistribution,
  };
}

// ── Get all feedback entries ────────────────────────────────────────

export async function getAllFeedback(page = 1, limit = 50) {
  await ensureTable();

  const offset = (page - 1) * limit;

  const result = await query(`
    SELECT
      ef.*,
      m.content AS reading_text,
      m.intent,
      u.display_name
    FROM expert_feedback ef
    JOIN messages m ON ef.message_id = m.id
    JOIN users u ON m.user_id = u.id
    ORDER BY ef.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  const countResult = await query('SELECT COUNT(*) AS total FROM expert_feedback');
  const total = parseInt(countResult.rows[0]?.total || 0);

  const feedback = result.rows.map(row => ({
    id: row.id,
    messageId: row.message_id,
    accuracyRating: row.accuracy_rating,
    adviceRating: row.advice_rating,
    toneRating: row.tone_rating,
    flags: row.flags,
    correctionText: row.correction_text,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
    readingPreview: (row.reading_text || '').slice(0, 150),
    intent: row.intent,
    userName: (row.display_name || 'Anonymous').split(' ')[0],
  }));

  return { feedback, total, page, limit };
}

// ── Get knowledge file stats ────────────────────────────────────────

export async function getKnowledgeStats() {
  // Read knowledge files from disk and count entries
  const fs = await import('fs');
  const pathMod = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = pathMod.default.dirname(fileURLToPath(import.meta.url));
  const knowledgeDir = pathMod.default.join(__dirname, '..', '..', 'knowledge', 'jyotish');

  const files = [
    'yogas.json',
    'nakshatras.json',
    'bhrigu-sutras.json',
    'dashas.json',
    'nadi-principles.json',
    'planet-in-sign.json',
    'remedies.json',
    'navagraha-temples.json',
  ];

  const stats = {};

  for (const file of files) {
    try {
      const filePath = pathMod.default.join(knowledgeDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const name = file.replace('.json', '');
      stats[name] = {
        entries: Array.isArray(data) ? data.length : Object.keys(data).length,
        sizeKb: Math.round(Buffer.byteLength(raw) / 1024),
      };
    } catch {
      const name = file.replace('.json', '');
      stats[name] = { entries: 0, sizeKb: 0, error: 'File not found' };
    }
  }

  return stats;
}
