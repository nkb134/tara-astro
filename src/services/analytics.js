import { query } from '../db/connection.js';
import { runAudit } from './qaAudit.js';
import { logger } from '../utils/logger.js';

// ── Sentiment word lists ────────────────────────────────────────────
const HAPPY_WORDS = [
  'thank', 'dhanyawad', 'shukriya', 'achha laga', 'great', 'amazing',
  'helpful', 'achha', 'bahut achha', 'correct', 'sahi', 'bilkul', 'haan',
  'nandri', 'romba nalla', 'super', 'wonderful', 'perfect', 'love',
];

const UNHAPPY_WORDS = [
  'bot', 'bakwaas', 'wrong', 'galat', 'nahi', 'crazy', 'weird',
  'kya hai ye', 'samajh nahi', 'kya bol rhe', 'faltu',
  'bekar', 'pagal', 'bore', 'waste',
];

function classifySentiment(text) {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  const isHappy = HAPPY_WORDS.some(w => lower.includes(w));
  const isUnhappy = UNHAPPY_WORDS.some(w => lower.includes(w));
  if (isHappy && !isUnhappy) return 'happy';
  if (isUnhappy) return 'unhappy';
  return 'neutral';
}

function timeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Main dashboard data function ────────────────────────────────────

export async function getDashboardData() {
  const startTime = Date.now();

  try {
    // Run all queries in parallel for speed
    const [
      totalUsersRes,
      onboardedRes,
      activeTodayRes,
      activeWeekRes,
      totalMsgsRes,
      msgsTodayRes,
      languageRes,
      agentRes,
      modelRes,
      avgResponseRes,
      avgResponseByAgentRes,
      hourlyRes,
      recentConvRes,
      errorRateRes,
      userMsgsForSentimentRes,
      topTopicsRes,
    ] = await Promise.all([
      // Total users
      query('SELECT COUNT(*) as count FROM users'),

      // Onboarded users
      query('SELECT COUNT(*) as count FROM users WHERE is_onboarded = true'),

      // Active today
      query("SELECT COUNT(*) as count FROM users WHERE last_active_at > NOW() - INTERVAL '24 hours'"),

      // Active this week
      query("SELECT COUNT(*) as count FROM users WHERE last_active_at > NOW() - INTERVAL '7 days'"),

      // Total messages
      query('SELECT COUNT(*) as count FROM messages'),

      // Messages today
      query("SELECT COUNT(*) as count FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'"),

      // Language breakdown
      query(`
        SELECT language, COUNT(*) as count
        FROM users
        WHERE language IS NOT NULL
        GROUP BY language
        ORDER BY count DESC
      `),

      // Agent (intent) usage breakdown
      query(`
        SELECT intent, COUNT(*) as count
        FROM messages
        WHERE intent IS NOT NULL AND role = 'assistant'
        GROUP BY intent
        ORDER BY count DESC
      `),

      // Model usage
      query(`
        SELECT model_used, COUNT(*) as count
        FROM messages
        WHERE model_used IS NOT NULL AND role = 'assistant'
        GROUP BY model_used
        ORDER BY count DESC
      `),

      // Average response time overall
      query(`
        SELECT COALESCE(AVG(response_time_ms), 0) as avg_ms
        FROM messages
        WHERE response_time_ms IS NOT NULL AND role = 'assistant'
      `),

      // Average response time by agent type
      query(`
        SELECT intent, COALESCE(AVG(response_time_ms), 0) as avg_ms
        FROM messages
        WHERE response_time_ms IS NOT NULL AND intent IS NOT NULL AND role = 'assistant'
        GROUP BY intent
        ORDER BY avg_ms DESC
      `),

      // Hourly message volume (last 24 hours)
      query(`
        SELECT
          TO_CHAR(created_at, 'HH24:00') as hour,
          COUNT(*) as count
        FROM messages
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY TO_CHAR(created_at, 'HH24:00')
        ORDER BY hour
      `),

      // Recent conversations: last 10 user messages paired with Tara's response
      query(`
        WITH recent_user_msgs AS (
          SELECT
            m.id, m.user_id, m.content as user_message, m.conversation_id,
            m.created_at, u.display_name
          FROM messages m
          JOIN users u ON m.user_id = u.id
          WHERE m.role = 'user'
          ORDER BY m.created_at DESC
          LIMIT 10
        )
        SELECT
          r.display_name,
          r.user_message,
          r.created_at,
          (
            SELECT content FROM messages
            WHERE conversation_id = r.conversation_id
              AND role = 'assistant'
              AND created_at > r.created_at
            ORDER BY created_at ASC
            LIMIT 1
          ) as tara_response,
          (
            SELECT intent FROM messages
            WHERE conversation_id = r.conversation_id
              AND role = 'assistant'
              AND created_at > r.created_at
            ORDER BY created_at ASC
            LIMIT 1
          ) as agent
        FROM recent_user_msgs r
        ORDER BY r.created_at DESC
      `),

      // Error rate: fallback responses / total assistant messages
      query(`
        SELECT
          COUNT(*) FILTER (WHERE model_used = 'fallback') as fallbacks,
          COUNT(*) as total
        FROM messages
        WHERE role = 'assistant'
      `),

      // User messages for sentiment analysis (last 200)
      query(`
        SELECT content FROM messages
        WHERE role = 'user'
        ORDER BY created_at DESC
        LIMIT 200
      `),

      // Top topics from conversations
      query(`
        SELECT topic, COUNT(*) as count
        FROM conversations
        WHERE topic IS NOT NULL
        GROUP BY topic
        ORDER BY count DESC
        LIMIT 10
      `),
    ]);

    // ── Process results ───────────────────────────────────────────────

    const totalUsers = parseInt(totalUsersRes.rows[0]?.count || 0);
    const onboarded = parseInt(onboardedRes.rows[0]?.count || 0);
    const activeToday = parseInt(activeTodayRes.rows[0]?.count || 0);
    const activeWeek = parseInt(activeWeekRes.rows[0]?.count || 0);
    const totalMessages = parseInt(totalMsgsRes.rows[0]?.count || 0);
    const messagesToday = parseInt(msgsTodayRes.rows[0]?.count || 0);
    const avgResponseMs = Math.round(parseFloat(avgResponseRes.rows[0]?.avg_ms || 0));

    // Avg messages per user
    const avgMessagesPerUser = totalUsers > 0 ? Math.round(totalMessages / totalUsers) : 0;

    // Language breakdown
    const languages = {};
    for (const row of languageRes.rows) {
      languages[row.language] = parseInt(row.count);
    }

    // Agent usage breakdown
    const agents = {};
    for (const row of agentRes.rows) {
      agents[row.intent] = parseInt(row.count);
    }

    // Model usage
    const models = {};
    for (const row of modelRes.rows) {
      models[row.model_used] = parseInt(row.count);
    }

    // Avg response time by agent
    const responseByAgent = {};
    for (const row of avgResponseByAgentRes.rows) {
      responseByAgent[row.intent] = Math.round(parseFloat(row.avg_ms));
    }

    // Hourly volume — fill in missing hours
    const hourlyMap = {};
    for (const row of hourlyRes.rows) {
      hourlyMap[row.hour] = parseInt(row.count);
    }
    const hourlyVolume = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now.getTime() - i * 3600000);
      const hourStr = h.toISOString().slice(11, 13) + ':00';
      hourlyVolume.push({ hour: hourStr, count: hourlyMap[hourStr] || 0 });
    }

    // Sentiment analysis
    const sentiment = { happy: 0, unhappy: 0, neutral: 0 };
    for (const row of userMsgsForSentimentRes.rows) {
      const cls = classifySentiment(row.content);
      sentiment[cls]++;
    }

    // Recent conversations
    const recentConversations = recentConvRes.rows.map(row => ({
      user: row.display_name || 'Anonymous',
      message: (row.user_message || '').slice(0, 100),
      response: (row.tara_response || '').slice(0, 100),
      agent: row.agent || 'unknown',
      time: timeAgo(row.created_at),
    }));

    // Error rate
    const fallbacks = parseInt(errorRateRes.rows[0]?.fallbacks || 0);
    const totalAssistant = parseInt(errorRateRes.rows[0]?.total || 1);
    const errorRate = ((fallbacks / totalAssistant) * 100).toFixed(1);

    // Top topics
    const topTopics = topTopicsRes.rows.map(r => ({
      topic: r.topic,
      count: parseInt(r.count),
    }));

    // Health score (reuse QA audit logic)
    let healthScore = 100;
    let qaIssues = {};
    try {
      const audit = await runAudit();
      healthScore = audit.healthScore;
      qaIssues = {};
      for (const [key, val] of Object.entries(audit.issues)) {
        qaIssues[key] = typeof val === 'object' ? val.count : val;
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'QA audit failed in dashboard — using defaults');
      qaIssues = { error: 'Audit unavailable' };
    }

    return {
      overview: {
        totalUsers,
        onboarded,
        activeToday,
        activeWeek,
        totalMessages,
        messagesToday,
        avgMessagesPerUser,
        avgResponseMs,
        healthScore,
      },
      sentiment,
      languages,
      agents,
      models,
      responseByAgent,
      hourlyVolume,
      recentConversations,
      topTopics,
      errorRate,
      qaIssues,
      generatedAt: new Date().toISOString(),
      queryTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Analytics dashboard query failed');
    throw err;
  }
}
