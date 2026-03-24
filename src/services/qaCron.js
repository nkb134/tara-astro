import cron from 'node-cron';
import { runAudit } from './qaAudit.js';
import { logger } from '../utils/logger.js';

const qaLogger = logger.child({ component: 'QA_AUDIT' });

const CRITICAL_ERROR_RATE = 10;      // percent
const CRITICAL_TRUNCATION_RATE = 20; // percent

async function executeAudit() {
  try {
    qaLogger.info('Starting scheduled QA audit');
    const report = await runAudit();

    if (report.totalMessages === 0) {
      qaLogger.info('QA audit complete — no messages to analyze');
      return;
    }

    // Determine severity
    const errorRate = parseFloat(report.errorRate);
    const truncationRate = report.issues.truncated.count / report.totalMessages * 100;
    const isCritical = errorRate > CRITICAL_ERROR_RATE || truncationRate > CRITICAL_TRUNCATION_RATE;

    if (isCritical) {
      qaLogger.error(
        { report, errorRate, truncationRate },
        `CRITICAL QA ISSUES — errorRate: ${errorRate.toFixed(1)}%, truncationRate: ${truncationRate.toFixed(1)}%`
      );
    } else {
      qaLogger.info(
        { report },
        `QA audit complete — healthScore: ${report.healthScore}/100, ${report.totalMessages} messages, ${report.totalUsers} users`
      );
    }
  } catch (err) {
    qaLogger.error({ err: err.message, stack: err.stack }, 'QA audit failed');
  }
}

export function startQaCron() {
  // Run at 00:00 and 12:00 daily
  cron.schedule('0 0 * * *', executeAudit, { timezone: 'Asia/Kolkata' });
  cron.schedule('0 12 * * *', executeAudit, { timezone: 'Asia/Kolkata' });

  qaLogger.info('QA audit cron scheduled — runs at 00:00 and 12:00 IST');
}
