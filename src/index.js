import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { verifyWebhook, receiveMessage, verifySignature } from './whatsapp/webhook.js';
import { runAudit } from './services/qaAudit.js';
import { startQaCron } from './services/qaCron.js';
import { startNudgeSystem } from './services/followUpNudge.js';
import { getDashboardData } from './services/analytics.js';
import {
  getReadingsForReview,
  submitFeedback,
  getFeedbackStats,
  getAllFeedback,
  getKnowledgeStats,
} from './services/expertService.js';
import {
  getUserByToken,
  getReadingsForUser,
  submitChartValidation,
  submitReadingFeedback,
} from './services/chartReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Trust proxy (Railway runs behind a reverse proxy)
app.set('trust proxy', 1);

// Security — allow Tailwind CDN for dashboard
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      'style-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      'font-src': ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

// Serve static files (dashboard assets)
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// Dashboard — serves the HTML page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// Dashboard API — returns JSON data for the dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (err) {
    logger.error({ err: err.message }, 'Dashboard API failed');
    res.status(500).json({ error: 'Dashboard data unavailable', message: err.message });
  }
});

// ── Expert Review Panel ─────────────────────────────────────────────

app.get('/expert', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'expert.html'));
});

app.get('/api/expert/readings', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const data = await getReadingsForReview(page, limit);
    res.json(data);
  } catch (err) {
    logger.error({ err: err.message }, 'Expert readings API failed');
    res.status(500).json({ error: 'Failed to load readings', message: err.message });
  }
});

app.post('/api/expert/feedback', async (req, res) => {
  try {
    const { messageId, ...feedback } = req.body;
    if (!messageId) {
      return res.status(400).json({ error: 'messageId is required' });
    }
    const result = await submitFeedback(messageId, feedback);
    res.json({ success: true, feedback: result });
  } catch (err) {
    logger.error({ err: err.message }, 'Expert feedback submission failed');
    res.status(500).json({ error: 'Failed to submit feedback', message: err.message });
  }
});

app.get('/api/expert/stats', async (req, res) => {
  try {
    const stats = await getFeedbackStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err: err.message }, 'Expert stats API failed');
    res.status(500).json({ error: 'Failed to load stats', message: err.message });
  }
});

app.get('/api/expert/feedback', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const data = await getAllFeedback(page, limit);
    res.json(data);
  } catch (err) {
    logger.error({ err: err.message }, 'Expert feedback list API failed');
    res.status(500).json({ error: 'Failed to load feedback', message: err.message });
  }
});

app.get('/api/expert/knowledge', async (req, res) => {
  try {
    const stats = await getKnowledgeStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err: err.message }, 'Expert knowledge API failed');
    res.status(500).json({ error: 'Failed to load knowledge stats', message: err.message });
  }
});

// ── Chart Review Panel (token-based access) ──────────────────────────

app.get('/chart/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'chart-review.html'));
});

app.get('/api/chart/:token', async (req, res) => {
  try {
    const user = await getUserByToken(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'Chart not found or link expired' });
    }

    const chartData = typeof user.chart_data === 'string'
      ? JSON.parse(user.chart_data) : user.chart_data;

    if (!chartData) {
      return res.status(404).json({ error: 'No chart data available' });
    }

    const readings = await getReadingsForUser(user.id);

    res.json({
      user: {
        displayName: user.display_name,
        birthDate: user.birth_date,
        birthTime: user.birth_time,
        birthTimeKnown: user.birth_time_known,
        birthPlace: user.birth_place,
        language: user.language,
      },
      chartData,
      readings,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Chart review API failed');
    res.status(500).json({ error: 'Failed to load chart', message: err.message });
  }
});

app.post('/api/chart/:token/validate', async (req, res) => {
  try {
    const user = await getUserByToken(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    const result = await submitChartValidation(user.id, req.body);
    res.json({ success: true, validation: result });
  } catch (err) {
    logger.error({ err: err.message }, 'Chart validation submission failed');
    res.status(500).json({ error: 'Failed to submit validation', message: err.message });
  }
});

app.post('/api/chart/:token/feedback', async (req, res) => {
  try {
    const user = await getUserByToken(req.params.token);
    if (!user) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    const { messageId, ...feedback } = req.body;
    if (!messageId) {
      return res.status(400).json({ error: 'messageId is required' });
    }
    const result = await submitReadingFeedback(messageId, feedback);
    res.json({ success: true, feedback: result });
  } catch (err) {
    logger.error({ err: err.message }, 'Chart reading feedback failed');
    res.status(500).json({ error: 'Failed to submit feedback', message: err.message });
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
    startNudgeSystem();
  });
});
