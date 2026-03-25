import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool, types } = pg;

// CRITICAL: Override DATE type parser to return raw string 'YYYY-MM-DD'
// instead of JS Date objects which shift dates due to timezone conversion.
// PostgreSQL DATE type OID = 1082
types.setTypeParser(1082, (val) => val);  // Return as-is: '1991-11-25' → '1991-11-25'

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
