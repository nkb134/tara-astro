import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { verifyWebhook, receiveMessage, verifySignature } from './whatsapp/webhook.js';
import { runAudit } from './services/qaAudit.js';
import { startQaCron } from './services/qaCron.js';

const app = express();

// Trust proxy (Railway runs behind a reverse proxy)
app.set('trust proxy', 1);

// Security
app.use(helmet());

// Rate limiting on webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Parse JSON with signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      // Store raw body for signature verification
      req.rawBody = buf;
      try {
        verifySignature(req, res, buf);
      } catch {
        // Log but don't block — verification might be optional in dev
        if (config.app.nodeEnv === 'production') {
          res.status(401).send('Invalid signature');
        }
      }
    },
  })
);

// Error stats (in-memory, resets on deploy — good enough for beta)
const errorStats = { gemini: 0, geocode: 0, webhook: 0, total: 0, lastError: null };
export function trackError(type, message) {
  errorStats[type] = (errorStats[type] || 0) + 1;
  errorStats.total++;
  errorStats.lastError = { type, message, at: new Date().toISOString() };
}

// Health check with error stats
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bot: config.app.botName,
    uptime: process.uptime(),
    errors: errorStats,
  });
});

// Detailed stats endpoint (for monitoring)
app.get('/stats', async (req, res) => {
  try {
    const { query: dbQuery } = await import('./db/connection.js');
    const users = await dbQuery('SELECT COUNT(*) as count FROM users');
    const onboarded = await dbQuery('SELECT COUNT(*) as count FROM users WHERE is_onboarded = true');
    const messages = await dbQuery('SELECT COUNT(*) as count FROM messages');
    const recentErrors = await dbQuery(
      "SELECT COUNT(*) as count FROM messages WHERE created_at > NOW() - INTERVAL '1 hour' AND model_used = 'fallback'"
    );
    res.json({
      users: parseInt(users.rows[0].count),
      onboarded: parseInt(onboarded.rows[0].count),
      messages: parseInt(messages.rows[0].count),
      errorsLastHour: parseInt(recentErrors.rows[0].count),
      errors: errorStats,
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QA audit endpoint (on-demand)
app.get('/qa-audit', async (req, res) => {
  try {
    const report = await runAudit();
    res.json(report);
  } catch (err) {
    logger.error({ err: err.message }, 'QA audit endpoint failed');
    res.status(500).json({ error: 'Audit failed', message: err.message });
  }
});

// WhatsApp webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', webhookLimiter, receiveMessage);

// Optional: reset DB on startup (for dev/testing)
async function maybeResetDb() {
  if (process.env.RESET_DB_ON_START !== 'true') return;
  try {
    const { query } = await import('./db/connection.js');
    await query('TRUNCATE users, conversations, messages RESTART IDENTITY CASCADE');
    logger.info('DB reset on startup (RESET_DB_ON_START=true)');
  } catch (err) {
    logger.error({ err: err.message }, 'DB reset failed — continuing anyway');
  }
}

// Start server
maybeResetDb().then(() => {
  app.listen(config.app.port, () => {
    logger.info({ port: config.app.port, env: config.app.nodeEnv }, `${config.app.botName} bot is running`);

    // Start QA audit cron
    startQaCron();
  });
});
