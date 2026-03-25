import { t, detectLanguage, detectScript, isLanguageNeutral } from '../languages/index.js';
import { updateUser } from '../db/users.js';
import { geocodeBirthPlace } from '../jyotish/geocode.js';
import { generateBirthChart } from '../jyotish/calculator.js';
import { formatChartOverview } from '../jyotish/chartFormatter.js';
import { generateReviewToken } from './chartReview.js';
import { llmParseBirthData } from './llmParser.js';
import { logger } from '../utils/logger.js';

// Convert birth_date to YYYY-MM-DD string
// node-postgres now returns DATE as raw string (see connection.js type override)
// so this is mostly a safety net for edge cases
function formatBirthDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    // Fallback: shouldn't happen with type parser override, but just in case
    // Add IST offset to avoid UTC date shift
    const istDate = new Date(val.getTime() + (5.5 * 60 * 60 * 1000));
    const y = istDate.getUTCFullYear();
    const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(istDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'string') return val.split('T')[0];
  return null;
}

// Per-step retry counter — escalates re-ask messages after failures
// Pattern from XState: guard-based transitions with retry awareness
const stepRetries = new Map();

function getStepRetryCount(userId, step) {
  const key = `${userId}_${step}`;
  const entry = stepRetries.get(key);
  if (entry && Date.now() - entry.time < 600000) return entry.count; // 10 min window
  return 0;
}

function trackStepRetry(userId, step) {
  const key = `${userId}_${step}`;
  const existing = stepRetries.get(key);
  const count = (existing && Date.now() - existing.time < 600000) ? existing.count + 1 : 1;
  stepRetries.set(key, { count, time: Date.now() });
  return count;
}

// Bug 5: Track last error to avoid repeats
const errorTracker = new Map();

function getErrorKey(userId, type) {
  const entry = errorTracker.get(userId);
  if (entry && entry.type === type && Date.now() - entry.time < 60000) {
    return entry.count;
  }
  return 0;
}

function trackError(userId, type) {
  const existing = errorTracker.get(userId);
  const count = (existing?.type === type && Date.now() - existing.time < 60000)
    ? existing.count + 1 : 1;
  errorTracker.set(userId, { type, time: Date.now(), count });
  return count;
}

// Bug 6: Frustration detection
const FRUSTRATION_PHRASES = [
  'i told you', 'i already said', 'already told', 'i just said', 'again', 'same thing',
  'maine bataya', 'pehle bhi bataya', 'phir se', 'suna nahi', 'wahi bata raha',
  'sonna-la', 'already sonnen', 'mendum solren', 'kekkala',
  'already cheppanu', 'malli cheptunna', 'age bolecho', 'abar bolchi',
];

function isFrustrated(text) {
  const lower = text.toLowerCase();
  return FRUSTRATION_PHRASES.some(p => lower.includes(p));
}

export async function handleOnboarding(user, messageText) {
  const step = user.onboarding_step || 'new';

  // Language + script handling
  let lang;
  if (step === 'new') {
    lang = detectLanguage(messageText);
    const script = detectScript(messageText);
    // Store both language AND script (latin vs devanagari etc.)
    await updateUser(user.id, { language: lang, preferences: JSON.stringify({ script }) }).catch(() => {});
    user.script = script;
  } else {
    lang = user.language || 'en';
    // For subsequent steps, only update language if message is NOT neutral
    // Pass stored language to prevent script switching
    if (!isLanguageNeutral(messageText)) {
      const detected = detectLanguage(messageText, user.language);
      if (detected !== 'en') {
        lang = detected;
        await updateUser(user.id, { language: lang }).catch(() => {});
      }
    }
  }

  logger.info({ step, lang, userId: user.id }, '[LANG] Onboarding step');

  // Bug 6: Check for frustration
  if (isFrustrated(messageText)) {
    logger.info({ userId: user.id }, 'Frustration detected');
    const apology = t(lang, 'frustration_apology');
    // Still try to parse what they said
    const parsed = parseAllFields(messageText);
    if (parsed.place || parsed.date || parsed.time) {
      // Process the repeated data
      return handleFrustratedRetry(user, messageText, lang, parsed, step);
    }
    // Can't parse — apologize and re-ask current step
    return { response: apology + '\n\n' + getStepPrompt(step, lang, user), messageType: 'onboarding' };
  }

  switch (step) {
    case 'new':
      return handleNewUser(user, messageText, lang);
    case 'awaiting_topic':
      return handleTopic(user, messageText, lang);
    case 'awaiting_name_dob':
      return handleNameDob(user, messageText, lang);
    case 'awaiting_dob':
      return handleDob(user, messageText, lang);
    case 'awaiting_time':
      return handleTime(user, messageText, lang);
    case 'awaiting_place':
      return handlePlace(user, messageText, lang);
    default:
      return { response: t(lang, 'welcome'), messageType: 'greeting' };
  }
}

function getStepPrompt(step, lang, user) {
  const name = user.display_name || '';
  switch (step) {
    case 'awaiting_name_dob': return t(lang, 'ask_name_default');
    case 'awaiting_dob': return t(lang, 'ask_dob_after_name').replace('{name}', name);
    case 'awaiting_time': return t(lang, 'ask_time');
    case 'awaiting_place': return t(lang, 'ask_place');
    default: return t(lang, 'welcome');
  }
}

async function handleFrustratedRetry(user, messageText, lang, parsed, currentStep) {
  const apology = t(lang, 'frustration_apology');

  // Try to complete as many steps as possible with parsed data
  if (parsed.place) {
    // They're giving place info — handle it
    if (parsed.time && !user.birth_time) {
      await updateUser(user.id, { birth_time: parsed.time.time, birth_time_known: parsed.time.known });
      user.birth_time = parsed.time.time;
    }
    const result = await generateChartFromPlace(user, parsed.place, lang);
    return { response: apology + '\n\n' + result.response, messageType: result.messageType, reviewToken: result.reviewToken };
  }

  if (parsed.time && currentStep === 'awaiting_time') {
    await updateUser(user.id, { birth_time: parsed.time.time, birth_time_known: parsed.time.known, onboarding_step: 'awaiting_place' });
    return { response: apology + '\n\n' + t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  if (parsed.date && currentStep === 'awaiting_dob') {
    await updateUser(user.id, { birth_date: parsed.date, onboarding_step: 'awaiting_time' });
    return { response: apology + '\n\n' + t(lang, 'ask_time'), messageType: 'onboarding' };
  }

  return { response: apology, messageType: 'simple' };
}

// --- Step handlers ---

async function handleTopic(user, messageText, lang) {
  // If user is still just greeting/chatting (e.g., "mein badhiya, aap kaise hain"),
  // respond warmly without asking for data yet
  if (isJustGreeting(messageText) || isCasualChat(messageText)) {
    return {
      response: t(lang, 'casual_chat_response'),
      messageType: 'simple',
    };
  }

  // User responded to "kisme madad karun?" — now ask for birth data
  const intent = classifyIntent(messageText);

  // Try to extract data if they gave it with their topic
  const parsed = await parseWithFallback(messageText, 'awaiting_topic');
  if (parsed.name && parsed.date) {
    const updates = { display_name: parsed.name, birth_date: parsed.date, preferences: JSON.stringify({ initial_intent: intent }) };
    if (parsed.time) { updates.birth_time = parsed.time.time; updates.birth_time_known = parsed.time.known; }
    updates.onboarding_step = parsed.time ? (parsed.place ? 'onboarded' : 'awaiting_place') : 'awaiting_time';
    await updateUser(user.id, updates);
    if (parsed.time && parsed.place) {
      user.birth_date = parsed.date; user.birth_time = parsed.time.time; user.display_name = parsed.name;
      return generateChartFromPlace(user, parsed.place, lang);
    }
    if (parsed.time) return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
    return { response: t(lang, 'ask_time_after_name_dob').replace('{name}', parsed.name), messageType: 'onboarding' };
  }

  // Use ask_topic_* (no re-introduction) since welcome_greeting already introduced Tara
  const intentKey = { career: 'ask_topic_career', marriage: 'ask_topic_marriage', health: 'ask_topic_health', general: 'ask_topic_general' }[intent] || 'ask_topic_default';
  await updateUser(user.id, { onboarding_step: 'awaiting_name_dob', preferences: JSON.stringify({ initial_intent: intent }) });
  return { response: t(lang, intentKey), messageType: 'onboarding' };
}

async function handleNewUser(user, messageText, lang) {
  const intent = classifyIntent(messageText);

  // Detect if this is just a greeting (hi, hello, namaste) vs a topic-specific request
  const isGreeting = isJustGreeting(messageText);

  if (isGreeting) {
    // Chat first — offer topic buttons
    await updateUser(user.id, { language: lang, onboarding_step: 'awaiting_topic' });
    return {
      response: t(lang, 'welcome_greeting'),
      messageType: 'greeting',
      useButtons: true,
      buttons: getTopicButtons(lang),
    };
  }

  // Topic-specific — ask for data
  const intentKey = {
    career: 'ask_name_career',
    marriage: 'ask_name_marriage',
    health: 'ask_name_health',
    general: 'ask_name_general',
  }[intent] || 'ask_name_default';

  // Try to extract name + DOB from first message (some users give everything upfront)
  const parsed = await parseWithFallback(messageText, 'new');

  if (parsed.name && parsed.date) {
    await updateUser(user.id, {
      language: lang,
      display_name: parsed.name,
      birth_date: parsed.date,
      preferences: JSON.stringify({ initial_intent: intent }),
      onboarding_step: parsed.time ? (parsed.place ? 'onboarded' : 'awaiting_place') : 'awaiting_time',
      ...(parsed.time ? { birth_time: parsed.time.time, birth_time_known: parsed.time.known } : {}),
    });

    if (parsed.time && parsed.place) {
      // All data given — generate chart
      user.birth_date = parsed.date;
      user.birth_time = parsed.time.time;
      user.display_name = parsed.name;
      return generateChartFromPlace(user, parsed.place, lang);
    }

    if (parsed.time) {
      return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
    }
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', parsed.name),
      messageType: 'onboarding',
    };
  }

  // Normal flow — send greeting, ask for name + DOB
  await updateUser(user.id, {
    language: lang,
    onboarding_step: 'awaiting_name_dob',
    preferences: JSON.stringify({ initial_intent: intent }),
  });

  return { response: t(lang, intentKey), messageType: 'greeting' };
}

async function handleNameDob(user, messageText, lang) {
  const parsed = await parseWithFallback(messageText, 'awaiting_name_dob');

  // User gave name + DOB (and maybe more)
  if (parsed.name && parsed.date) {
    const updates = { display_name: parsed.name, birth_date: parsed.date };

    if (parsed.time && parsed.place) {
      updates.birth_time = parsed.time.time;
      updates.birth_time_known = parsed.time.known;
      updates.onboarding_step = 'onboarded';
      await updateUser(user.id, updates);
      user.birth_date = parsed.date;
      user.birth_time = parsed.time.time;
      user.display_name = parsed.name;
      return generateChartFromPlace(user, parsed.place, lang);
    }

    if (parsed.time) {
      updates.birth_time = parsed.time.time;
      updates.birth_time_known = parsed.time.known;
      updates.onboarding_step = 'awaiting_place';
      await updateUser(user.id, updates);
      return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
    }

    updates.onboarding_step = 'awaiting_time';
    await updateUser(user.id, updates);
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', parsed.name),
      messageType: 'onboarding',
    };
  }

  // Only date, no name-like text
  if (parsed.date && !parsed.name) {
    const name = user.display_name || 'friend';
    await updateUser(user.id, { birth_date: parsed.date, onboarding_step: 'awaiting_time' });
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', name),
      messageType: 'onboarding',
    };
  }

  // Only name (no date found) — but be careful not to treat sentences as names
  const name = parsed.name || extractName(messageText);

  // If we couldn't extract a name, the user probably sent a sentence/question
  // Treat it as intent + re-ask for name and DOB
  if (!name) {
    const intent = classifyIntent(messageText);
    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
    await updateUser(user.id, { preferences: JSON.stringify({ ...prefs, initial_intent: intent }) });
    // Acknowledge their concern and ask for data
    const intentKey = { career: 'ask_topic_career', marriage: 'ask_topic_marriage', health: 'ask_topic_health', general: 'ask_topic_general' }[intent] || 'ask_topic_default';
    return { response: t(lang, intentKey), messageType: 'onboarding' };
  }

  await updateUser(user.id, { display_name: name, onboarding_step: 'awaiting_dob' });
  return {
    response: t(lang, 'ask_dob_after_name').replace('{name}', name),
    messageType: 'onboarding',
  };
}

async function handleDob(user, messageText, lang) {
  const parsed = await parseWithFallback(messageText, 'awaiting_dob');
  const name = user.display_name || 'friend';

  if (!parsed.date) {
    const retries = trackStepRetry(user.id, 'dob');
    const key = retries >= 3 ? 'invalid_date_final' : retries >= 2 ? 'invalid_date_retry' : 'invalid_date';
    return { response: t(lang, key), messageType: 'simple' };
  }

  // Check if time and/or place also included
  if (parsed.time && parsed.place) {
    await updateUser(user.id, {
      birth_date: parsed.date, birth_time: parsed.time.time,
      birth_time_known: parsed.time.known, onboarding_step: 'onboarded',
    });
    user.birth_date = parsed.date;
    user.birth_time = parsed.time.time;
    return generateChartFromPlace(user, parsed.place, lang);
  }

  if (parsed.time) {
    await updateUser(user.id, {
      birth_date: parsed.date, birth_time: parsed.time.time,
      birth_time_known: parsed.time.known, onboarding_step: 'awaiting_place',
    });
    return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  await updateUser(user.id, { birth_date: parsed.date, onboarding_step: 'awaiting_time' });
  return { response: t(lang, 'ask_time'), messageType: 'onboarding' };
}

async function handleTime(user, messageText, lang) {
  const parsed = await parseWithFallback(messageText, 'awaiting_time');

  // Bug 3: Handle combined time + place
  if (parsed.time && parsed.place) {
    await updateUser(user.id, {
      birth_time: parsed.time.time, birth_time_known: parsed.time.known,
    });
    user.birth_time = parsed.time.time;
    return generateChartFromPlace(user, parsed.place, lang);
  }

  // Place only (no time found — maybe "pata nahi, Jagdalpur")
  if (parsed.place && !parsed.time) {
    // Check if there's an "unknown time" signal
    const timeResult = parseTime(messageText);
    if (timeResult) {
      await updateUser(user.id, {
        birth_time: timeResult.time, birth_time_known: timeResult.known,
      });
      user.birth_time = timeResult.time;
    } else {
      // Default to unknown time
      await updateUser(user.id, { birth_time: '12:00:00', birth_time_known: false });
      user.birth_time = '12:00:00';
    }
    return generateChartFromPlace(user, parsed.place, lang);
  }

  // Time only
  if (parsed.time) {
    await updateUser(user.id, {
      birth_time: parsed.time.time, birth_time_known: parsed.time.known,
      onboarding_step: 'awaiting_place',
    });

    // Bug 7: Different message for unknown vs known time
    if (!parsed.time.known) {
      return { response: t(lang, 'ask_place_after_unknown_time'), messageType: 'onboarding' };
    }
    return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  // Try just time parsing
  const time = parseTime(messageText);
  if (time) {
    await updateUser(user.id, {
      birth_time: time.time, birth_time_known: time.known,
      onboarding_step: 'awaiting_place',
    });
    if (!time.known) {
      return { response: t(lang, 'ask_place_after_unknown_time'), messageType: 'onboarding' };
    }
    return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  const retries = trackStepRetry(user.id, 'time');
  // After 3 retries, skip time entirely and move to place
  if (retries >= 3) {
    await updateUser(user.id, { birth_time: '12:00:00', birth_time_known: false, onboarding_step: 'awaiting_place' });
    return { response: t(lang, 'invalid_time_final'), messageType: 'onboarding' };
  }
  const key = retries >= 2 ? 'invalid_time_retry' : 'invalid_time';
  return { response: t(lang, key), messageType: 'simple' };
}

// Single non-place tokens (acknowledgments, questions, filler)
const NON_PLACE_TOKENS = new Set([
  'ok', 'okay', 'yes', 'no', 'haan', 'nahi', 'ha', 'nhi', 'ji', 'theek',
  'thik', 'accha', 'acha', 'sahi', 'done', 'hmm', 'ohh', 'oh',
  'kya', 'kyu', 'kyun', 'kaise', 'why', 'what', 'how',
  'ho', 'gya', 'hogya', 'hua', 'hai', 'hain',
  'seri', 'illa', 'enna', 'achu', 'sollunga',
  'wait', 'ruko', 'abhi', 'ek', 'min', 'hello', 'hi',
  'haan', 'acha', 'theek', 'sahi', 'avunu', 'chettu',
  'bolo', 'batao', 'bata', 'tell', 'me',
]);

function isDenialOrCorrection(text) {
  const lower = text.toLowerCase().trim();
  const denialPatterns = [
    /\b(nhi|nahi|nahin|no|nope|wrong|galat|sahi nahi|theek nahi|correct nahi)\b/i,
    /\b(up nhi|nhi.*nhi|not.*right|thats wrong|that's wrong)\b/i,
    /\b(galat hai|yeh nahi|ye nahi|woh nahi|wait|ruko|rukiye)\b/i,
    /\b(change|badlo|badliye|correction|sudhar)\b/i,
  ];
  // Must be short (< 8 words) AND match a denial pattern
  const words = lower.split(/\s+/);
  if (words.length > 8) return false;
  return denialPatterns.some(p => p.test(lower));
}

function isQuestion(text) {
  const lower = text.toLowerCase().trim();
  // Ends with ? or starts with question words
  if (lower.endsWith('?')) return true;
  const questionStarts = /^(what|when|where|why|how|kya|kab|kahan|kyun|kaise|kitna|kaun|which)/i;
  return questionStarts.test(lower);
}

function isNonPlaceInput(text) {
  const lower = text.toLowerCase().replace(/[?!.,]+/g, '').trim();
  // Every word must be a non-place token
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return true;
  return words.every(w => NON_PLACE_TOKENS.has(w));
}

async function handlePlace(user, messageText, lang) {
  const place = messageText.trim();
  if (place.length < 2) return { response: t(lang, 'ask_place'), messageType: 'simple' };

  // Filter out non-place responses (acknowledgments, questions, etc.)
  if (isNonPlaceInput(place)) {
    return { response: t(lang, 'ask_place'), messageType: 'simple' };
  }

  // Filter out denial/correction phrases — "nhi up nhi", "no thats wrong", "galat hai"
  if (isDenialOrCorrection(place)) {
    return { response: t(lang, 'place_correction_prompt'), messageType: 'simple' };
  }

  // Filter out questions — "what's the date?", "kitna time lagega?"
  if (isQuestion(place)) {
    return { response: t(lang, 'ask_place'), messageType: 'simple' };
  }

  // Check if user is responding to disambiguation (sent "1", "2", etc.)
  const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
  if (prefs.pendingGeoOptions) {
    const choice = parseInt(place);
    if (choice >= 1 && choice <= prefs.pendingGeoOptions.length) {
      const selected = prefs.pendingGeoOptions[choice - 1];
      // Clear pending options
      const newPrefs = { ...prefs };
      delete newPrefs.pendingGeoOptions;
      await updateUser(user.id, { preferences: JSON.stringify(newPrefs) });
      // Use selected option directly
      return generateChartFromGeo(user, selected, lang);
    }
    // User typed something else — try it as a new place
    const newPrefs = { ...prefs };
    delete newPrefs.pendingGeoOptions;
    await updateUser(user.id, { preferences: JSON.stringify(newPrefs) });
  }

  return generateChartFromPlace(user, place, lang);
}

async function generateChartFromGeo(user, geoData, lang) {
  const name = user.display_name || 'friend';
  try {
    const birthTime = (user.birth_time || '12:00').slice(0, 5);
    const birthDate = formatBirthDate(user.birth_date);

    const chartData = generateBirthChart(
      birthDate, birthTime, geoData.lat, geoData.lng,
      geoData.timezone || 'Asia/Kolkata', geoData.formatted
    );

    if (!chartData || chartData.moonSign === 'Unknown') {
      return { response: t(lang, 'chart_failed'), messageType: 'simple' };
    }

    await updateUser(user.id, {
      birth_place: geoData.formatted,
      birth_lat: geoData.lat, birth_lng: geoData.lng,
      birth_timezone: geoData.timezone || 'Asia/Kolkata',
      chart_data: JSON.stringify(chartData),
      onboarding_step: 'onboarded', is_onboarded: true,
    });

    // Generate review token for chart review page
    let reviewToken = null;
    try {
      reviewToken = await generateReviewToken(user.id);
    } catch (err) {
      logger.warn({ err: err.message, userId: user.id }, 'Failed to generate review token');
    }

    const locationConfirm = t(lang, 'location_confirmed').replace('{place}', geoData.formatted);
    const generating = t(lang, 'generating_chart');
    return { response: `${locationConfirm}\n\n${generating}`, messageType: 'reading', chartData, reviewToken };
  } catch (err) {
    logger.error({ err: err.message }, 'Chart generation failed');
    return { response: t(lang, 'chart_failed'), messageType: 'simple' };
  }
}

async function generateChartFromPlace(user, place, lang) {
  const name = user.display_name || 'friend';

  const geo = await geocodeBirthPlace(place, lang);

  if (!geo) {
    const errorCount = trackError(user.id, 'geocode');
    const key = errorCount >= 2 ? 'geocode_failed_2' : 'geocode_failed';
    return { response: t(lang, key), messageType: 'simple' };
  }

  // Handle disambiguation
  if (geo.ambiguous) {
    if (geo.tooMany) {
      return { response: t(lang, 'disambiguate_many'), messageType: 'simple' };
    }
    const options = geo.options || [];
    const optionList = options.map((o, i) => `${i + 1}. ${o.formatted}`).join('\n');
    const msg = t(lang, 'disambiguate_few')
      .replace('{city}', place)
      .replace('{options}', optionList);
    // Store options in user preferences for next message
    await updateUser(user.id, {
      preferences: JSON.stringify({ ...(typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : user.preferences), pendingGeoOptions: options }),
    });
    return { response: msg, messageType: 'simple' };
  }

  try {
    const birthTime = (user.birth_time || '12:00').slice(0, 5);
    const birthDate = formatBirthDate(user.birth_date);

    const chartData = generateBirthChart(
      birthDate, birthTime, geo.lat, geo.lng, geo.timezone, geo.formattedPlace
    );

    if (!chartData || chartData.moonSign === 'Unknown') {
      const errorCount = trackError(user.id, 'chart');
      const key = errorCount >= 2 ? 'chart_failed_2' : 'chart_failed';
      return { response: t(lang, key), messageType: 'simple' };
    }

    await updateUser(user.id, {
      birth_place: geo.formattedPlace,
      birth_lat: geo.lat, birth_lng: geo.lng,
      birth_timezone: geo.timezone,
      chart_data: JSON.stringify(chartData),
      onboarding_step: 'onboarded', is_onboarded: true,
    });

    // Generate review token for chart review page
    let reviewToken = null;
    try {
      reviewToken = await generateReviewToken(user.id);
    } catch (err) {
      logger.warn({ err: err.message, userId: user.id }, 'Failed to generate review token');
    }

    // Confirm location + generating message
    const locationConfirm = t(lang, 'location_confirmed').replace('{place}', geo.formattedPlace);
    const generating = t(lang, 'generating_chart');
    return { response: `${locationConfirm}\n\n${generating}`, messageType: 'reading', chartData, reviewToken };
  } catch (err) {
    logger.error({ err: err.message, userId: user.id }, 'Chart generation failed');
    const errorCount = trackError(user.id, 'chart');
    const key = errorCount >= 2 ? 'chart_failed_2' : 'chart_failed';
    return { response: t(lang, key), messageType: 'simple' };
  }
}

// --- Smart parser: regex first, LLM fallback ---

/**
 * Parse with regex, fall back to LLM if regex misses key fields.
 * The LLM call only fires when regex returns nothing useful.
 */
async function parseWithFallback(text, currentStep = '') {
  const regexResult = parseAllFields(text);

  // Determine what we NEED based on current step
  const needsDate = ['new', 'awaiting_name_dob', 'awaiting_dob'].includes(currentStep);
  const needsTime = currentStep === 'awaiting_time';
  const needsPlace = currentStep === 'awaiting_place';

  // Check if regex got what we need
  const regexGotIt = (needsDate && regexResult.date)
    || (needsTime && (regexResult.time || regexResult.place))
    || (needsPlace && regexResult.place)
    || (regexResult.date && regexResult.name); // Got name+date combo

  if (regexGotIt) {
    return regexResult; // Regex worked, no LLM needed
  }

  // Regex failed — try LLM (costs ~50 tokens, ~500ms)
  logger.info({ text, step: currentStep, regexResult }, '[PARSER] Regex missed, trying LLM fallback');
  try {
    const llmResult = await llmParseBirthData(text, currentStep);

    // Merge: LLM fills in what regex missed, regex wins where both found something
    return {
      name: regexResult.name || llmResult.name,
      date: regexResult.date || llmResult.date,
      time: regexResult.time || llmResult.time,
      place: regexResult.place || llmResult.place,
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[PARSER] LLM fallback failed, using regex result');
    return regexResult;
  }
}

// --- Regex-only parser (fast path) ---

function parseAllFields(text) {
  const result = { name: null, date: null, time: null, place: null };
  let remaining = text.trim();

  // Strip frustration prefixes
  remaining = remaining.replace(/^(i told you|i already said|already told|maine bataya|sonna-la)\s*[-—,]?\s*/i, '');

  // Extract date
  const dateResult = extractDate(remaining);
  if (dateResult) {
    result.date = dateResult.date;
    remaining = dateResult.remaining.trim();
  }

  // Extract time
  const timeResult = extractTimeFromText(remaining);
  if (timeResult) {
    result.time = timeResult.time;
    remaining = timeResult.remaining.trim();
  }

  // If we have a date and remaining text, it's likely a name (not a place)
  // Extract name BEFORE trying place to avoid "Nissar" being treated as a city
  if (remaining.length > 1 && result.date) {
    result.name = extractName(remaining);
    // After extracting name, check if there's ALSO a place in the remaining text
    // Only do place lookup against known cities DB (not fallback)
    const placeResult = extractPlaceStrict(remaining);
    if (placeResult) {
      result.place = placeResult.place;
    }
  } else if (remaining.length > 1) {
    // No date found — try place lookup (with fallback for standalone place inputs)
    const placeResult = extractPlace(remaining);
    if (placeResult) {
      result.place = placeResult.place;
      remaining = placeResult.remaining.trim();
    }
    // If no place found either, treat as name
    if (!result.place && remaining.length > 1) {
      result.name = extractName(remaining);
    }
  }

  return result;
}

// Strict place extraction — only matches known cities in DB, no fallback
function extractPlaceStrict(text) {
  let cities;
  try {
    const fs = await_import_fs();
    const pathMod = await_import_path();
    const citiesPath = pathMod.join(process.cwd(), 'knowledge/india-cities.json');
    cities = JSON.parse(fs.readFileSync(citiesPath, 'utf-8'));
  } catch { return null; }

  const cleaned = text.toLowerCase().replace(/[,.\-]+/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(p => p.length > 1);

  for (const part of parts) {
    if (cities[part]) return { place: part, remaining: text.replace(new RegExp(part, 'i'), '').trim() };
  }
  return null;
}

function extractPlace(text) {
  // Try to load cities database
  let cities;
  try {
    const fs = await_import_fs();
    const pathMod = await_import_path();
    const citiesPath = pathMod.join(process.cwd(), 'knowledge/india-cities.json');
    cities = JSON.parse(fs.readFileSync(citiesPath, 'utf-8'));
  } catch {
    return null;
  }

  // Clean and split text
  const cleaned = text.toLowerCase()
    .replace(/[,.\-]+/g, ' ')
    .replace(/\b(district|city|town|near|paas|ke|ka|ki)\b/g, '')
    .trim();

  const parts = cleaned.split(/\s+/).filter(p => p.length > 1);

  // Try each part against cities database
  for (const part of parts) {
    if (cities[part]) {
      const remaining = text.replace(new RegExp(part, 'i'), '').replace(/[,\s]+/g, ' ').trim();
      return { place: part, remaining };
    }
  }

  // Try combined parts
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, parts.length); j++) {
      const combined = parts.slice(i, j).join(' ');
      if (cities[combined]) {
        return { place: combined, remaining: '' };
      }
    }
  }

  // If text looks like a place name (not a date/time/name), return as-is
  if (parts.length <= 3 && !extractDate(text) && !parseTime(text)) {
    return { place: text.trim(), remaining: '' };
  }

  return null;
}

// Sync fs/path helpers (avoid top-level import issues)
function await_import_fs() {
  return require('fs');
}
function await_import_path() {
  return require('path');
}

// Use createRequire for CJS modules in ESM
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function extractDate(text) {
  // Match the ORIGINAL text with ordinals first, so we can strip correctly from remaining
  // Pattern: "10th June 1990", "10 June 1990", "June 10, 1990", "10/06/1990"
  const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)\b/gi, '$1');

  const slashMatch = cleaned.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (slashMatch) {
    const [full, day, month, year] = slashMatch;
    const d = new Date(year, month - 1, day);
    if (isValidDate(d, day, month, year)) {
      // Remove from ORIGINAL text — match with optional ordinal suffix
      const origPattern = new RegExp(`\\d{1,2}(?:st|nd|rd|th)?[\\s\\/\\-.]\\d{1,2}[\\s\\/\\-.]\\d{4}`, 'i');
      return { date: formatDate(d), remaining: text.replace(origPattern, '').trim() };
    }
  }

  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };

  // Match ORIGINAL text with ordinals to get correct remaining
  const origPatterns = [
    /(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})/i,
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
  ];

  for (const pattern of origPatterns) {
    const match = text.match(pattern);
    if (match) {
      let day, monthStr, year;
      if (/^\d/.test(match[1])) {
        [, day, monthStr, year] = match;
      } else {
        [, monthStr, day, year] = match;
      }
      const month = months[monthStr.toLowerCase()];
      if (month) {
        const d = new Date(year, month - 1, day);
        if (isValidDate(d, day, month, year)) {
          return { date: formatDate(d), remaining: text.replace(match[0], '') };
        }
      }
    }
  }

  return null;
}

function extractTimeFromText(text) {
  const time = parseTime(text);
  if (!time) return null;

  let remaining = text;
  remaining = remaining.replace(/\d{1,2}:\d{2}\s*(am|pm)/i, '');
  remaining = remaining.replace(/\d{1,2}\s*(am|pm)/i, '');
  remaining = remaining.replace(/(morning|evening|afternoon|night|kaalaiyil|kaalai|maalai|subah|shaam|raat|dopahar)/gi, '');
  remaining = remaining.replace(/\d{1,2}:\d{2}/, '');
  remaining = remaining.replace(/(pata nahi|don't know|theriyaadhu|teliyadu|ariyilla|gottilla|jani na)/gi, '');

  return { time, remaining: remaining.trim() };
}

function parseTime(text) {
  const lower = text.toLowerCase().trim();

  const unknownPhrases = ['theriyaadhu', 'theriyathu', 'therla', "don't know",
    'dont know', 'not sure', 'not confirmed', 'not exactly', 'not remember',
    'pata nahi', 'nahi pata', 'malum nahi', 'teliyadu',
    'ariyilla', 'gottilla', 'jani na', 'unknown', 'no idea', 'no clue',
    'paravala', 'parledu', 'koi baat nahi', 'chalega', 'na janle',
    'theriyaatina', 'theriyaati', 'yaad nahi', 'remember nahi'];
  if (unknownPhrases.some(p => lower.includes(p))) {
    return { time: '12:00:00', known: false };
  }

  const ampmMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (ampmMatch) {
    let [, hours, minutes, period] = ampmMatch;
    hours = parseInt(hours);
    minutes = parseInt(minutes || '0');
    if (period.toLowerCase() === 'pm' && hours !== 12) hours += 12;
    if (period.toLowerCase() === 'am' && hours === 12) hours = 0;
    return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, known: true };
  }

  const h24Match = lower.match(/(\d{1,2}):(\d{2})/);
  if (h24Match) {
    const hours = parseInt(h24Match[1]);
    const minutes = parseInt(h24Match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, known: true };
    }
  }

  const morningWords = ['kaalaiyil', 'kaalai', 'morning', 'subah', 'subha', 'ravile', 'udayam', 'beligge', 'sokal'];
  const eveningWords = ['maalai', 'evening', 'saam', 'shaam', 'sanje', 'bikel'];
  const afternoonWords = ['madhiyaanam', 'afternoon', 'dopahar', 'dupur'];
  const nightWords = ['night', 'iravu', 'raat', 'raatri', 'rathri'];

  const numMatch = lower.match(/(\d{1,2})/);
  if (numMatch) {
    let hours = parseInt(numMatch[1]);
    if (morningWords.some(w => lower.includes(w)) && hours <= 12) return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true };
    if (afternoonWords.some(w => lower.includes(w))) { if (hours < 12) hours += 12; return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true }; }
    if (eveningWords.some(w => lower.includes(w))) { if (hours < 12) hours += 12; return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true }; }
    if (nightWords.some(w => lower.includes(w))) { if (hours < 12) hours += 12; return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true }; }
  }

  if (morningWords.some(w => lower.includes(w))) return { time: '08:00:00', known: false };
  if (afternoonWords.some(w => lower.includes(w))) return { time: '12:00:00', known: false };
  if (eveningWords.some(w => lower.includes(w))) return { time: '17:00:00', known: false };
  if (nightWords.some(w => lower.includes(w))) return { time: '21:00:00', known: false };

  return null;
}

// --- Helpers ---

// Interactive button helpers
function getTopicButtons(lang) {
  const labels = {
    hi: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Shaadi / Rishte' }, { id: 'topic_health', title: 'Health' }],
    en: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Marriage' }, { id: 'topic_health', title: 'Health' }],
    ta: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Thirumanam' }, { id: 'topic_health', title: 'Udal Nalam' }],
    te: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Pelli' }, { id: 'topic_health', title: 'Aarogyam' }],
    bn: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Biye' }, { id: 'topic_health', title: 'Swasthya' }],
    ml: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Vivaaham' }, { id: 'topic_health', title: 'Aarogyam' }],
    kn: [{ id: 'topic_career', title: 'Career' }, { id: 'topic_marriage', title: 'Maduve' }, { id: 'topic_health', title: 'Aarogya' }],
  };
  return labels[lang] || labels.en;
}

export function getPostChartButtons(lang) {
  const labels = {
    hi: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Shaadi / Rishte' }, { id: 'read_health', title: 'Health' }],
    en: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Relationships' }, { id: 'read_health', title: 'Health' }],
    ta: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Thirumanam' }, { id: 'read_health', title: 'Udal Nalam' }],
    te: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Pelli' }, { id: 'read_health', title: 'Aarogyam' }],
    bn: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Biye' }, { id: 'read_health', title: 'Swasthyo' }],
    ml: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Vivaaham' }, { id: 'read_health', title: 'Aarogyam' }],
    kn: [{ id: 'read_career', title: 'Career' }, { id: 'read_marriage', title: 'Maduve' }, { id: 'read_health', title: 'Aarogya' }],
  };
  return labels[lang] || labels.en;
}

function isCasualChat(text) {
  const lower = text.toLowerCase().trim();
  const casualPatterns = [
    /\b(badhiya|badiya|theek|thik|achha|acha|fine|good|great|ok|sab badhiya|mast)\b/i,
    /\b(aap kaise|kaise ho|how are you|kemiti achanti|eppadi|kemon achen)\b/i,
    /\b(mein badhiya|i am fine|i'm good|i'm fine|doing well|doing good)\b/i,
  ];
  return casualPatterns.some(p => p.test(lower));
}

function isJustGreeting(text) {
  const lower = text.toLowerCase().trim();
  const greetingWords = ['hi', 'hello', 'hey', 'namaste', 'namaskar', 'namaskaram', 'namaskara',
    'vanakkam', 'pranam', 'pranaam', 'hii', 'hiii', 'helloo', 'helloji',
    'jai shri krishna', 'radhe radhe', 'ram ram', 'jai mata di', 'jai ho'];
  // Casual/social words that accompany greetings (not topic-specific)
  const casualWords = ['ji', 'madam', 'didi', 'sir', 'bhai', 'there',
    'good', 'morning', 'evening', 'afternoon', 'kaise', 'hain', 'ho',
    'aap', 'kemiti', 'achanti', 'enna', 'eppadi', 'irukeenga', 'irukkinga',
    'kemon', 'achen', 'ela', 'unnaru', 'hegiddira', 'sugama',
    'how', 'are', 'you', 'doing', 'mein', 'badhiya', 'theek', 'thik'];

  const stripped = lower.replace(/[🙏😊🌟✨💫!?.,]+/g, '').trim();
  if (greetingWords.includes(stripped)) return true;

  // If the message STARTS with a greeting word and the rest is casual/social, it's a greeting
  const words = stripped.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return false;
  const firstIsGreeting = greetingWords.some(g => g === words[0] || g.split(' ')[0] === words[0]);
  if (firstIsGreeting) {
    // All remaining words should be casual/social
    const rest = words.slice(1);
    if (rest.length === 0) return true;
    if (rest.length <= 4 && rest.every(w => casualWords.includes(w))) return true;
  }

  return false;
}

function classifyIntent(text) {
  const lower = text.toLowerCase();
  const careerWords = ['career', 'job', 'work', 'business', 'money', 'finance', 'salary', 'promotion', 'naukri', 'paisa', 'velai', 'thozhil', 'udyogam', 'chakri'];
  const marriageWords = ['marriage', 'love', 'relationship', 'partner', 'husband', 'wife', 'wedding', 'shaadi', 'shaadhi', 'pyar', 'thirumanam', 'kalyanam', 'pelli', 'biye', 'vivah', 'rishte', 'rishta'];
  const healthWords = ['health', 'sehat', 'swasthya', 'bimari', 'disease', 'udal', 'aarogya', 'tabiyat', 'doctor', 'medical', 'pet', 'sir dard', 'neend'];
  if (careerWords.some(w => lower.includes(w))) return 'career';
  if (marriageWords.some(w => lower.includes(w))) return 'marriage';
  if (healthWords.some(w => lower.includes(w))) return 'health';
  return 'general';
}

// Common English/Hindi words that should NEVER be treated as names
const NOT_NAMES = new Set([
  // English verbs/phrases
  'have', 'has', 'had', 'quit', 'left', 'want', 'need', 'like', 'know', 'think',
  'feel', 'looking', 'seeking', 'help', 'please', 'tell', 'give', 'show', 'find',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'been', 'being', 'doing', 'going', 'having', 'getting', 'making', 'taking',
  'about', 'after', 'before', 'between', 'from', 'into', 'with', 'without',
  'very', 'much', 'more', 'most', 'some', 'any', 'many', 'few', 'all', 'every',
  'the', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'just', 'really', 'actually', 'currently', 'recently', 'already', 'still',
  'not', 'don', 'didn', 'doesn', 'won', 'can', 'isn', 'aren', 'wasn', 'weren',
  'job', 'work', 'career', 'marriage', 'shaadi', 'health', 'money', 'life',
  'stressed', 'worried', 'confused', 'lost', 'stuck', 'depressed', 'anxious',
  // Hindi verbs/common words
  'kya', 'hai', 'hain', 'tha', 'thi', 'the', 'hoon', 'hun', 'raha', 'rahi',
  'karna', 'chahiye', 'chahte', 'chahti', 'karein', 'karo', 'batao', 'bataiye',
  'mujhe', 'mera', 'meri', 'mere', 'apna', 'apni', 'apne', 'aap', 'aapka',
  'bahut', 'bohot', 'kaafi', 'thoda', 'zyada', 'kuch', 'sab', 'bilkul',
  'abhi', 'pehle', 'baad', 'jaldi', 'dheere', 'phir', 'wapas',
  'nahi', 'nahin', 'nhi', 'mat', 'sirf', 'bas',
  'chhodh', 'chhod', 'chhodi', 'chhoda', 'quit', 'left', 'resigned',
]);

// Detect if text looks like a sentence rather than a name
function isSentence(text) {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // A name is typically 1-3 words. Sentences are longer.
  if (words.length > 4) return true;

  // If text contains sentence markers, it's not a name
  const sentenceMarkers = /\b(i |i'm |i've |i'll |my |me |we |you |your |he |she |they |is |am |are |was |were |been |have |has |had |do |does |did |will |would |can |could |should |shall |may |might |must |need |want |please |help |tell |about |because |since |when |where |how |why |what |which |but |and |or |so |if |then |also |too |very |really |just |not |no |don't |didn't |can't |won't )\b/i;
  if (sentenceMarkers.test(lower)) return true;

  // Hindi sentence markers
  const hindiSentenceMarkers = /\b(mujhe |mera |meri |main |hum |aap |kya |kaise |kahaan |kab |kyun |chahiye |chahte |karein |karo |batao |bataiye |hai |hain |tha |thi |hoon |raha |rahi |nahi |nhi |mat |bhi )\b/i;
  if (hindiSentenceMarkers.test(lower)) return true;

  return false;
}

function extractName(text) {
  // If text looks like a sentence, it's NOT a name
  if (isSentence(text)) return null;

  let name = text.trim()
    .replace(/^(my name is|i am|i'm|naam hai|mera naam|en peyar|naa peru|amar naam)\s*/i, '')
    .replace(/^(name:|peyar:|peru:)\s*/i, '')
    // Strip "date of birth", "dob", "date", "birth" fragments that leak from multi-line input
    .replace(/\b(date\s+of\s+birth|dob|janam\s+tithi|janam\s+din|birth\s+date)\b/gi, '')
    .replace(/[,.\-]+$/, '')
    .trim();
  // Remove stray numbers/ordinals that leaked from date extraction
  name = name.replace(/\b\d{1,2}(?:st|nd|rd|th)?\b\.?/gi, '').trim();
  // Remove common filler words that aren't names
  name = name.replace(/^(and|aur|or)\s+/i, '').trim();

  const words = name.split(/\s+/).filter(w => w.length > 1).slice(0, 3);

  // Filter out words that are clearly not names
  const nameWords = words.filter(w => !NOT_NAMES.has(w.toLowerCase()));

  // If ALL words were filtered out, this isn't a name
  if (nameWords.length === 0) return null;

  // Indian names can be 3 words (first + middle/father + last)
  // Take max 3 words for name, but prefer first 2 if > 3
  name = nameWords.slice(0, 3)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return name || null;
}

function isValidDate(d, day, month, year) {
  return d instanceof Date && !isNaN(d) &&
    d.getDate() === parseInt(day) &&
    d.getMonth() === parseInt(month) - 1 &&
    parseInt(year) >= 1920 && parseInt(year) <= 2015;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}
