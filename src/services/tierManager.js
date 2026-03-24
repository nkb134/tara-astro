/**
 * User Tier Manager — determines what level of service a user gets.
 *
 * Tiers:
 * - free: First session free (up to FREE_MESSAGE_LIMIT messages)
 * - paid: Active paid session
 * - expired: Paid session expired, needs renewal
 * - blocked: Free limit exceeded, no paid session
 *
 * Token budgets are enforced at the dispatcher level based on tier.
 */
import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

// Free tier limits
const FREE_MESSAGE_LIMIT = 20;        // Messages before requiring payment
const FREE_READING_LIMIT = 3;         // Deep readings before requiring payment

/**
 * Check user's current tier and whether they're blocked.
 * Returns { tier, blocked, reason, messagesUsed, readingsUsed }
 */
export async function checkUserTier(user) {
  try {
    // Check for active paid session
    const activeSession = await query(
      `SELECT * FROM paid_sessions
       WHERE user_id = $1 AND status = 'active' AND payment_status = 'paid'
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );

    if (activeSession.rows.length > 0) {
      return {
        tier: 'paid',
        blocked: false,
        reason: null,
        session: activeSession.rows[0],
      };
    }

    // Check for expired paid session
    const expiredSession = await query(
      `SELECT * FROM paid_sessions
       WHERE user_id = $1 AND status = 'active' AND payment_status = 'paid'
       AND expires_at <= NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );

    if (expiredSession.rows.length > 0) {
      // Mark as expired
      await query(
        `UPDATE paid_sessions SET status = 'expired' WHERE id = $1`,
        [expiredSession.rows[0].id]
      ).catch(() => {});

      return {
        tier: 'expired',
        blocked: true,
        reason: 'session_expired',
      };
    }

    // Free tier — count messages
    const msgCount = await query(
      `SELECT COUNT(*) as count FROM messages WHERE user_id = $1 AND role = 'user'`,
      [user.id]
    );
    const messagesUsed = parseInt(msgCount.rows[0]?.count || '0');

    // Count deep readings (messages with complex intent from bot)
    const readingCount = await query(
      `SELECT COUNT(*) as count FROM messages
       WHERE user_id = $1 AND role = 'assistant'
       AND intent IN ('career_reading', 'relationship_reading', 'kundli_overview', 'reading')`,
      [user.id]
    );
    const readingsUsed = parseInt(readingCount.rows[0]?.count || '0');

    // First session not used yet — always allow
    if (!user.is_first_session_used) {
      return {
        tier: 'free',
        blocked: false,
        reason: null,
        messagesUsed,
        readingsUsed,
      };
    }

    // Free limit exceeded
    if (messagesUsed >= FREE_MESSAGE_LIMIT) {
      return {
        tier: 'blocked',
        blocked: true,
        reason: 'free_limit',
        messagesUsed,
        readingsUsed,
      };
    }

    return {
      tier: 'free',
      blocked: false,
      reason: null,
      messagesUsed,
      readingsUsed,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Tier check failed, allowing access');
    // Fail open — don't block users due to DB errors
    return {
      tier: 'free',
      blocked: false,
      reason: null,
    };
  }
}
