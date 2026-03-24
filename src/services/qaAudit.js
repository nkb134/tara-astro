import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

// ── Pattern definitions ──────────────────────────────────────────────

const BANNED_WORDS = [
  'expertise', 'as an ai', 'i am a bot', 'language model',
  'i am an ai', 'as a bot', 'i\'m a bot', 'i\'m an ai',
];

const COMPLAINT_PATTERNS = [
  'bot ho', 'bot hai', 'bakwaas', 'kya hai ye',
  'crazy', 'weird', 'pagal', 'bekar',
];

const GREETING_PATTERNS = [
  /\bnamaste\b/i, /\bnamaskar\b/i, /\bnaan tara\b/i,
  /\bmain tara hoon\b/i, /\bvanakkam\b/i,
];

const TOPIC_KEYWORDS = {
  career: ['career', 'job', 'naukri', 'kaam', 'business', 'promotion', 'salary', 'velai'],
  marriage: ['shaadi', 'marriage', 'vivah', 'partner', 'husband', 'wife', 'rishta', 'kalyanam', 'wedding'],
  health: ['health', 'sehat', 'bimari', 'illness', 'doctor', 'disease', 'pain', 'dard', 'udal'],
  finance: ['money', 'paisa', 'dhan', 'wealth', 'loan', 'investment', 'property', 'financial'],
  education: ['study', 'padhai', 'exam', 'college', 'university', 'education', 'school'],
};

const SLOW_THRESHOLD_MS = 15000;
const LONG_MESSAGE_CHARS = 500;
const REPEATED_PHRASE_MIN_WORDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────

function detectTopic(text) {
  const lower = text.toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return topic;
  }
  return null;
}

function isTruncated(text) {
  if (!text || text.length < 10) return false;
  const trimmed = text.trimEnd();
  const lastChar = trimmed[trimmed.length - 1];
  // Ends with normal punctuation — not truncated
  if (/[.!?।…"')}\]؟۔]/.test(lastChar)) return false;
  // Check tail: text after the last space
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return false;
  const tail = trimmed.slice(lastSpace + 1);
  return tail.length < 20;
}

function extractPhrases(text, minWords) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const phrases = [];
  for (let i = 0; i <= words.length - minWords; i++) {
    phrases.push(words.slice(i, i + minWords).join(' '));
  }
  return phrases;
}

function snippet(text, maxLen = 60) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

// ── Main audit function ──────────────────────────────────────────────

export async function runAudit() {
  const startTime = Date.now();

  // Fetch last 100 messages with user info
  const { rows: messages } = await query(`
    SELECT
      m.id, m.user_id, m.role, m.content, m.model_used,
      m.response_time_ms, m.created_at, m.conversation_id,
      u.display_name, u.whatsapp_id
    FROM messages m
    JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at DESC
    LIMIT 100
  `);

  if (messages.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      period: 'last_100_messages',
      totalMessages: 0,
      totalUsers: 0,
      issues: {},
      healthScore: 100,
    };
  }

  const uniqueUsers = new Set(messages.map(m => m.user_id));
  const taraMessages = messages.filter(m => m.role === 'assistant');
  const userMessages = messages.filter(m => m.role === 'user');

  // ── a. Truncated messages ──────────────────────────────────────────
  const truncated = [];
  for (const msg of taraMessages) {
    if (isTruncated(msg.content)) {
      truncated.push(snippet(msg.content));
    }
  }

  // ── b. Topic drift ────────────────────────────────────────────────
  const topicDrift = [];
  // Group messages by conversation, check user→assistant pairs
  const byConversation = {};
  for (const msg of messages) {
    const cid = msg.conversation_id;
    if (!byConversation[cid]) byConversation[cid] = [];
    byConversation[cid].push(msg);
  }
  for (const convMsgs of Object.values(byConversation)) {
    // Sort chronologically within conversation
    convMsgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (let i = 0; i < convMsgs.length - 1; i++) {
      const curr = convMsgs[i];
      const next = convMsgs[i + 1];
      if (curr.role === 'user' && next.role === 'assistant') {
        const userTopic = detectTopic(curr.content);
        const taraTopic = detectTopic(next.content);
        if (userTopic && taraTopic && userTopic !== taraTopic) {
          topicDrift.push(`User asked about ${userTopic}, Tara responded about ${taraTopic}`);
        }
      }
    }
  }

  // ── c. Repeated content ───────────────────────────────────────────
  const repeatedContent = [];
  const phrasesByUser = {};
  for (const msg of taraMessages) {
    const uid = msg.user_id;
    if (!phrasesByUser[uid]) phrasesByUser[uid] = {};
    const phrases = extractPhrases(msg.content, REPEATED_PHRASE_MIN_WORDS);
    for (const phrase of phrases) {
      if (!phrasesByUser[uid][phrase]) phrasesByUser[uid][phrase] = 0;
      phrasesByUser[uid][phrase]++;
    }
  }
  for (const [userId, phrases] of Object.entries(phrasesByUser)) {
    for (const [phrase, count] of Object.entries(phrases)) {
      if (count >= 2) {
        repeatedContent.push(snippet(phrase, 80));
      }
    }
  }
  // Deduplicate similar repeated phrases (keep unique-ish ones)
  const uniqueRepeated = [...new Set(repeatedContent)].slice(0, 5);

  // ── d. Re-greetings ──────────────────────────────────────────────
  const reGreetings = [];
  // Find the first Tara message per user
  const firstMsgByUser = {};
  for (const msg of [...taraMessages].reverse()) {
    // Reverse so we process oldest first
    firstMsgByUser[msg.user_id] = msg.id;
  }
  for (const msg of taraMessages) {
    if (msg.id === firstMsgByUser[msg.user_id]) continue; // skip first message
    if (GREETING_PATTERNS.some(pat => pat.test(msg.content))) {
      reGreetings.push(snippet(msg.content));
    }
  }

  // ── e. Long messages ──────────────────────────────────────────────
  const longMessages = taraMessages.filter(m => m.content.length > LONG_MESSAGE_CHARS);
  const avgLongLength = longMessages.length > 0
    ? Math.round(longMessages.reduce((s, m) => s + m.content.length, 0) / longMessages.length)
    : 0;

  // ── f. Fallback responses ─────────────────────────────────────────
  const fallbacks = messages.filter(m => m.model_used === 'fallback');
  const fallbackRate = messages.length > 0 ? (fallbacks.length / messages.length) * 100 : 0;

  // ── g. Banned words ───────────────────────────────────────────────
  const bannedWordHits = [];
  for (const msg of taraMessages) {
    const lower = msg.content.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (lower.includes(word)) {
        bannedWordHits.push({ word, example: snippet(msg.content) });
      }
    }
  }

  // ── h. User complaints ────────────────────────────────────────────
  const complaints = [];
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase();
    if (COMPLAINT_PATTERNS.some(pat => lower.includes(pat))) {
      complaints.push(snippet(msg.content));
    }
  }

  // ── i. Slow responses ─────────────────────────────────────────────
  const slowResponses = messages.filter(m =>
    m.response_time_ms && m.response_time_ms > SLOW_THRESHOLD_MS
  );
  const avgSlowMs = slowResponses.length > 0
    ? Math.round(slowResponses.reduce((s, m) => s + m.response_time_ms, 0) / slowResponses.length)
    : 0;

  // ── j. Error rate ─────────────────────────────────────────────────
  const errorRate = fallbackRate;

  // ── Health score (0-100) ──────────────────────────────────────────
  // Start at 100, deduct for issues
  let healthScore = 100;
  const taraCount = taraMessages.length || 1;
  healthScore -= Math.min(20, (truncated.length / taraCount) * 100);
  healthScore -= Math.min(15, topicDrift.length * 5);
  healthScore -= Math.min(10, uniqueRepeated.length * 3);
  healthScore -= Math.min(10, reGreetings.length * 3);
  healthScore -= Math.min(10, (longMessages.length / taraCount) * 30);
  healthScore -= Math.min(15, fallbackRate * 1.5);
  healthScore -= Math.min(10, bannedWordHits.length * 10);
  healthScore -= Math.min(10, complaints.length * 3);
  healthScore -= Math.min(10, (slowResponses.length / (messages.length || 1)) * 50);
  healthScore = Math.max(0, Math.round(healthScore));

  const report = {
    timestamp: new Date().toISOString(),
    period: 'last_100_messages',
    totalMessages: messages.length,
    totalUsers: uniqueUsers.size,
    auditDurationMs: Date.now() - startTime,
    issues: {
      truncated: { count: truncated.length, examples: truncated.slice(0, 3) },
      topicDrift: { count: topicDrift.length, examples: topicDrift.slice(0, 3) },
      repeatedContent: { count: uniqueRepeated.length, examples: uniqueRepeated.slice(0, 3) },
      reGreetings: { count: reGreetings.length, examples: reGreetings.slice(0, 3) },
      longMessages: { count: longMessages.length, avgLength: avgLongLength },
      fallbacks: { count: fallbacks.length, rate: `${fallbackRate.toFixed(1)}%` },
      bannedWords: { count: bannedWordHits.length, examples: bannedWordHits.slice(0, 3) },
      userComplaints: { count: complaints.length, examples: complaints.slice(0, 3) },
      slowResponses: { count: slowResponses.length, avgMs: avgSlowMs },
    },
    errorRate: `${errorRate.toFixed(1)}%`,
    healthScore,
  };

  return report;
}
