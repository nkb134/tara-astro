/**
 * Token Usage Tracker — logs estimated token usage per user for billing/analytics.
 *
 * Stores in-memory with periodic DB flush.
 * Tracks: model, agent type, input/output tokens, estimated cost.
 */
import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

// Approximate costs per 1M tokens (USD) — Gemini pricing as of March 2026
const COST_PER_1M = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash-lite': { input: 0.00, output: 0.00 }, // Essentially free for classification
};

// In-memory buffer for batch inserts
const usageBuffer = [];
const FLUSH_INTERVAL = 60000; // Flush every 60s
const FLUSH_BATCH_SIZE = 50;

// Start periodic flush
setInterval(() => flushUsage(), FLUSH_INTERVAL);

/**
 * Track token usage for a user interaction.
 */
export async function trackTokenUsage(userId, usage) {
  const { agent, model, inputTokens, outputTokens } = usage;
  const cost = estimateCost(model, inputTokens, outputTokens);

  usageBuffer.push({
    userId,
    agent,
    model,
    inputTokens,
    outputTokens,
    costUsd: cost,
    timestamp: new Date(),
  });

  logger.debug({
    userId,
    agent,
    model,
    inputTokens,
    outputTokens,
    costUsd: cost.toFixed(6),
  }, 'Token usage tracked');

  // Flush if buffer is large
  if (usageBuffer.length >= FLUSH_BATCH_SIZE) {
    await flushUsage();
  }
}

/**
 * Estimate cost in USD.
 */
function estimateCost(model, inputTokens, outputTokens) {
  const pricing = COST_PER_1M[model] || COST_PER_1M['gemini-2.5-flash'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Flush usage buffer to DB (best-effort).
 */
async function flushUsage() {
  if (usageBuffer.length === 0) return;

  const batch = usageBuffer.splice(0, FLUSH_BATCH_SIZE);

  try {
    // Ensure table exists (auto-create on first flush)
    await query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        agent VARCHAR(30),
        model VARCHAR(50),
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_usd DECIMAL(10,8),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Batch insert
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const u of batch) {
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
      params.push(u.userId, u.agent, u.model, u.inputTokens, u.outputTokens, u.costUsd);
      paramIdx += 6;
    }

    await query(
      `INSERT INTO token_usage (user_id, agent, model, input_tokens, output_tokens, cost_usd) VALUES ${values.join(', ')}`,
      params
    );

    logger.info({ count: batch.length }, 'Token usage flushed to DB');
  } catch (err) {
    logger.warn({ err: err.message }, 'Token usage flush failed, data lost');
    // Don't re-add to buffer — accept loss for non-critical analytics
  }
}

/**
 * Get total token usage for a user (for billing dashboards).
 */
export async function getUserTokenUsage(userId) {
  try {
    const result = await query(
      `SELECT
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(cost_usd) as total_cost,
        COUNT(*) as total_requests,
        agent, model
       FROM token_usage
       WHERE user_id = $1
       GROUP BY agent, model`,
      [userId]
    );
    return result.rows;
  } catch {
    return [];
  }
}
