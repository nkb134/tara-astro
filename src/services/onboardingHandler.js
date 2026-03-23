import { t, detectLanguage, isLanguageNeutral } from '../languages/index.js';
import { updateUser } from '../db/users.js';
import { geocodeBirthPlace } from '../jyotish/geocode.js';
import { generateBirthChart } from '../jyotish/calculator.js';
import { formatChartOverview } from '../jyotish/chartFormatter.js';
import { logger } from '../utils/logger.js';

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

  // Bug 2: Language handling — detect from first message, read from DB afterwards
  let lang;
  if (step === 'new') {
    lang = detectLanguage(messageText);
    await updateUser(user.id, { language: lang }).catch(() => {});
  } else {
    // For subsequent steps, only update language if message is NOT neutral
    lang = user.language || 'en';
    if (!isLanguageNeutral(messageText)) {
      const detected = detectLanguage(messageText);
      if (detected !== 'en' || lang === 'en') {
        // Only switch if we detected something specific (not default English)
        if (detected !== 'en') {
          lang = detected;
          await updateUser(user.id, { language: lang }).catch(() => {});
        }
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
    return { response: apology + '\n\n' + result.response, messageType: result.messageType };
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

async function handleNewUser(user, messageText, lang) {
  const intent = classifyIntent(messageText);

  // Bug 1: Always greet with full introduction
  const intentKey = {
    career: 'ask_name_career',
    marriage: 'ask_name_marriage',
    general: 'ask_name_general',
  }[intent] || 'ask_name_default';

  // Try to extract name + DOB from first message (some users give everything upfront)
  const parsed = parseAllFields(messageText);

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
  const parsed = parseAllFields(messageText);

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

  // Only name (no date found)
  const name = parsed.name || extractName(messageText);
  await updateUser(user.id, { display_name: name, onboarding_step: 'awaiting_dob' });
  return {
    response: t(lang, 'ask_dob_after_name').replace('{name}', name),
    messageType: 'onboarding',
  };
}

async function handleDob(user, messageText, lang) {
  const parsed = parseAllFields(messageText);
  const name = user.display_name || 'friend';

  if (!parsed.date) {
    return { response: t(lang, 'invalid_date'), messageType: 'simple' };
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
  const parsed = parseAllFields(messageText);

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

  return { response: t(lang, 'invalid_time'), messageType: 'simple' };
}

async function handlePlace(user, messageText, lang) {
  const place = messageText.trim();
  if (place.length < 2) return { response: t(lang, 'ask_place'), messageType: 'simple' };
  return generateChartFromPlace(user, place, lang);
}

async function generateChartFromPlace(user, place, lang) {
  const name = user.display_name || 'friend';

  // Bug 4: Geocoding with better error handling
  const geo = await geocodeBirthPlace(place);
  if (!geo) {
    const errorCount = trackError(user.id, 'geocode');
    // Bug 5: Escalating error messages
    const key = errorCount >= 2 ? 'geocode_failed_2' : 'geocode_failed';
    return { response: t(lang, key), messageType: 'simple' };
  }

  try {
    const birthTime = (user.birth_time || '12:00').slice(0, 5);
    const birthDate = typeof user.birth_date === 'string'
      ? user.birth_date.split('T')[0] : String(user.birth_date);

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

    // Send generating message first, chart overview will follow
    return { response: t(lang, 'generating_chart'), messageType: 'reading', chartData };
  } catch (err) {
    logger.error({ err: err.message, userId: user.id }, 'Chart generation failed');
    const errorCount = trackError(user.id, 'chart');
    const key = errorCount >= 2 ? 'chart_failed_2' : 'chart_failed';
    return { response: t(lang, key), messageType: 'simple' };
  }
}

// --- Smart multi-field parser (Bug 3) ---

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

  // Bug 3: Check remaining text for place (against india-cities.json)
  if (remaining.length > 1) {
    const placeResult = extractPlace(remaining);
    if (placeResult) {
      result.place = placeResult.place;
      remaining = placeResult.remaining.trim();
    }
  }

  // Whatever remains might be a name
  if (remaining.length > 1 && !result.date && !result.time && !result.place) {
    result.name = extractName(remaining);
  } else if (remaining.length > 1 && result.date) {
    // Text before the date might be the name
    result.name = extractName(remaining);
  }

  return result;
}

function extractPlace(text) {
  // Try to load cities database
  let cities;
  try {
    const fs = await_import_fs();
    const path = await_import_path();
    const citiesPath = path.join(process.cwd(), 'knowledge/india-cities.json');
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
  const slashMatch = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (slashMatch) {
    const [full, day, month, year] = slashMatch;
    const d = new Date(year, month - 1, day);
    if (isValidDate(d, day, month, year)) {
      return { date: formatDate(d), remaining: text.replace(full, '') };
    }
  }

  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };

  const patterns = [
    /(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})/i,
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
  ];

  for (const pattern of patterns) {
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
    'dont know', 'not sure', 'pata nahi', 'nahi pata', 'malum nahi', 'teliyadu',
    'ariyilla', 'gottilla', 'jani na', 'unknown', 'no idea',
    'paravala', 'parledu', 'koi baat nahi', 'chalega', 'na janle',
    'theriyaatina', 'theriyaati'];
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

function classifyIntent(text) {
  const lower = text.toLowerCase();
  const careerWords = ['career', 'job', 'work', 'business', 'money', 'finance', 'salary', 'promotion', 'naukri', 'paisa', 'velai', 'thozhil', 'udyogam', 'chakri'];
  const marriageWords = ['marriage', 'love', 'relationship', 'partner', 'husband', 'wife', 'wedding', 'shaadi', 'shaadhi', 'pyar', 'thirumanam', 'kalyanam', 'pelli', 'biye', 'vivah'];
  if (careerWords.some(w => lower.includes(w))) return 'career';
  if (marriageWords.some(w => lower.includes(w))) return 'marriage';
  return 'general';
}

function extractName(text) {
  let name = text.trim()
    .replace(/^(my name is|i am|i'm|naam hai|mera naam|en peyar|naa peru|amar naam)\s*/i, '')
    .replace(/^(name:|peyar:|peru:)\s*/i, '')
    .replace(/[,.\-]+$/, '')
    .trim();
  const words = name.split(/\s+/).filter(w => w.length > 0).slice(0, 2);
  name = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name || text.trim().split(/\s+/)[0];
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
