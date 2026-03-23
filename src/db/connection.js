import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    if (!config.db.url) {
      logger.warn('DATABASE_URL not set — database features disabled');
      return null;
    }
    pool = new Pool({
      connectionString: config.db.url,
      ssl: config.app.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
    });
    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database pool error');
    });
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  if (!p) return { rows: [] };
  const start = Date.now();
  const result = await p.query(text, params);
  const duration = Date.now() - start;
  logger.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'db query');
  return result;
}
