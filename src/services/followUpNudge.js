/**
 * Follow-up nudge system — makes Tara feel human by following up naturally.
 *
 * Trigger 1: 15-min silence — user went quiet mid-conversation
 * Trigger 2: 5 PM same-day — had a session earlier today (requires template after 24h)
 *
 * All messages are casual, first-person, contextual — never robotic.
 */
import { query } from '../db/connection.js';
import { sendTextMessage } from '../whatsapp/sender.js';
import { logger } from '../utils/logger.js';

// Track active conversations — set after each user message
const activeConversations = new Map(); // whatsappId → { lastMessageAt, userId, lang, name, topic, nudgeSent }

export function trackUserActivity(whatsappId, userId, lang, name, topic) {
  activeConversations.set(whatsappId, {
    lastMessageAt: Date.now(),
    userId,
    lang: lang || 'hi',
    name: name || '',
    topic: topic || '',
    nudgeSent: false,
  });
}

export function clearUserActivity(whatsappId) {
  activeConversations.delete(whatsappId);
}

// 15-min nudge phrases — casual, warm, human
const NUDGE_15MIN = {
  hi: [
    'Arre, aap hain? Main yahan hoon agar kuch aur poochna ho 😊',
    'Sab theek hai? Agar koi aur sawaal ho toh pooch lijiye, main hoon yahan',
    'Hmm... aap chup ho gaye. Koi aur baat poochni hai?',
    'Main yahan hoon, jab chaaho baat kar sakte hain 😊',
  ],
  en: [
    "Hey, are you still there? I'm here if you want to ask anything else 😊",
    "Everything okay? Feel free to ask if you have more questions",
    "I'm here whenever you're ready to continue 😊",
  ],
  ta: [
    'Enna achu? Naan inga irukken, enna venum-na kelunga 😊',
    'Seri, vera enna therinjukka venum? Naan inga irukken',
  ],
  te: [
    'Emi ayyindi? Nenu ikkade unnanu, emi adagali ante adagandi 😊',
  ],
  or: [
    'Kemiti achanti? Mu ethire achhi, kichchhi poochhibaku chaahile kahanti 😊',
  ],
};

function getNudgeMessage(lang) {
  const phrases = NUDGE_15MIN[lang] || NUDGE_15MIN.hi;
  return phrases[Math.floor(Math.random() * phrases.length)];
}

// Check for 15-min inactive users and nudge them (runs every 5 min)
async function check15MinNudge() {
  const now = Date.now();
  const fifteenMin = 15 * 60 * 1000;

  for (const [whatsappId, data] of activeConversations.entries()) {
    const elapsed = now - data.lastMessageAt;

    // Only nudge if 15-20 min have passed and we haven't nudged yet
    if (elapsed >= fifteenMin && elapsed < fifteenMin + (10 * 60 * 1000) && !data.nudgeSent) {
      try {
        const msg = getNudgeMessage(data.lang);
        await sendTextMessage(whatsappId, msg);
        data.nudgeSent = true;
        logger.info({ whatsappId, elapsed: Math.round(elapsed / 1000) }, 'Sent 15-min nudge');
      } catch (err) {
        logger.warn({ err: err.message, whatsappId }, 'Failed to send 15-min nudge');
      }
    }

    // Clean up entries older than 1 hour (they've left)
    if (elapsed > 60 * 60 * 1000) {
      activeConversations.delete(whatsappId);
    }
  }
}

// 5 PM daily nudge — find users who chatted today but went silent
// NOTE: This only works within 24-hour window. For older users, need Meta template.
async function check5PMNudge() {
  try {
    // Find users who were active today (after midnight IST) but haven't messaged in last 2 hours
    const result = await query(`
      SELECT DISTINCT u.whatsapp_id, u.display_name, u.language, u.id,
        (SELECT content FROM messages WHERE user_id = u.id AND role = 'user' ORDER BY created_at DESC LIMIT 1) as last_msg
      FROM users u
      JOIN messages m ON m.user_id = u.id
      WHERE u.is_onboarded = true
        AND m.created_at > CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'
        AND m.created_at < NOW() - INTERVAL '2 hours'
        AND u.last_active_at < NOW() - INTERVAL '2 hours'
        AND u.last_active_at > NOW() - INTERVAL '24 hours'
    `);

    const nudgePhrases = {
      hi: [
        '{name}, aaj subah jo baat hui thi uske baare mein soch rahi thi... kuch aur jaanna hai?',
        '{name}, kundli mein kuch aur interesting dikha tha batana chahti thi. Free ho toh batao?',
        'Arre {name}, aaj ki baat adhoori reh gayi thi. Kab free hain?',
      ],
      en: [
        '{name}, I was thinking about our conversation earlier... want to continue?',
        "Hey {name}, noticed something interesting in your chart I didn't mention. Free to chat?",
      ],
    };

    for (const user of result.rows) {
      const lang = user.language || 'hi';
      const phrases = nudgePhrases[lang] || nudgePhrases.hi;
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      const name = user.display_name?.split(' ')[0] || '';
      const msg = phrase.replace('{name}', name);

      try {
        await sendTextMessage(user.whatsapp_id, msg);
        logger.info({ whatsappId: user.whatsapp_id, name }, 'Sent 5PM nudge');
      } catch (err) {
        logger.warn({ err: err.message, whatsappId: user.whatsapp_id }, '5PM nudge failed (may be outside 24h window)');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '5PM nudge check failed');
  }
}

// Start the nudge timers
export function startNudgeSystem() {
  // Check for 15-min inactive users every 5 minutes
  setInterval(check15MinNudge, 5 * 60 * 1000);

  // Schedule 5 PM IST nudge
  // IST = UTC+5:30, so 5 PM IST = 11:30 AM UTC
  const schedule5PM = () => {
    const now = new Date();
    // Convert to IST
    const istHour = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
    const istMin = (now.getUTCMinutes() + 30) % 60;

    if (istHour === 17 && istMin >= 0 && istMin < 5) {
      check5PMNudge();
    }
  };
  setInterval(schedule5PM, 5 * 60 * 1000);

  logger.info('Nudge system started (15-min check + 5PM IST daily)');
}
