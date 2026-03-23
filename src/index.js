import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { verifyWebhook, receiveMessage, verifySignature } from './whatsapp/webhook.js';

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: config.app.botName, uptime: process.uptime() });
});

// WhatsApp webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', webhookLimiter, receiveMessage);

// Start server
app.listen(config.app.port, () => {
  logger.info({ port: config.app.port, env: config.app.nodeEnv }, `${config.app.botName} bot is running`);
});
