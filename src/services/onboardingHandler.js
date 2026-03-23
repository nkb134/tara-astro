import { t, detectLanguage } from '../languages/index.js';
import { updateUser } from '../db/users.js';
import { geocodeBirthPlace } from '../jyotish/geocode.js';
import { generateBirthChart } from '../jyotish/calculator.js';
import { formatChartOverview } from '../jyotish/chartFormatter.js';
import { logger } from '../utils/logger.js';

export async function handleOnboarding(user, messageText) {
  const step = user.onboarding_step || 'new';
  const detectedLang = detectLanguage(messageText);
  const lang = step === 'new' ? detectedLang : (user.language || detectedLang);

  if (detectedLang !== 'en' || !user.language) {
    await updateUser(user.id, { language: detectedLang }).catch(() => {});
  }

  switch (step) {
    case 'new':
      return handleNewUser(user, messageText, detectedLang);
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

// --- Step handlers ---

async function handleNewUser(user, messageText, lang) {
  const intent = classifyIntent(messageText);

  // Try to extract name + DOB from first message
  const parsed = parseMultiField(messageText);

  if (parsed.name && parsed.date) {
    // User gave everything upfront — fast track
    await updateUser(user.id, {
      language: lang,
      display_name: parsed.name,
      birth_date: parsed.date,
      preferences: JSON.stringify({ initial_intent: intent }),
      onboarding_step: parsed.time ? 'awaiting_place' : 'awaiting_time',
      ...(parsed.time ? { birth_time: parsed.time.time, birth_time_known: parsed.time.known } : {}),
    });

    if (parsed.time) {
      return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
    }
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', parsed.name),
      messageType: 'onboarding',
    };
  }

  // Normal flow — ask for name + DOB
  await updateUser(user.id, {
    language: lang,
    onboarding_step: 'awaiting_name_dob',
    preferences: JSON.stringify({ initial_intent: intent }),
  });

  const intentKey = {
    career: 'ask_name_career',
    marriage: 'ask_name_marriage',
    general: 'ask_name_general',
  }[intent] || 'ask_name_default';

  return { response: t(lang, intentKey), messageType: 'greeting' };
}

async function handleNameDob(user, messageText, lang) {
  const parsed = parseMultiField(messageText);

  // User gave name + DOB together
  if (parsed.name && parsed.date) {
    await updateUser(user.id, {
      display_name: parsed.name,
      birth_date: parsed.date,
      onboarding_step: 'awaiting_time',
    });
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', parsed.name),
      messageType: 'onboarding',
    };
  }

  // User gave only a date (no name-like text)
  if (parsed.date && !parsed.name) {
    // Treat as name missing, use display_name from WhatsApp profile or "friend"
    const name = user.display_name || 'friend';
    await updateUser(user.id, {
      birth_date: parsed.date,
      onboarding_step: 'awaiting_time',
    });
    return {
      response: t(lang, 'ask_time_after_name_dob').replace('{name}', name),
      messageType: 'onboarding',
    };
  }

  // User gave only name (no date found)
  if (parsed.name || (!parsed.date && messageText.trim().length < 30)) {
    const name = parsed.name || extractName(messageText);
    await updateUser(user.id, {
      display_name: name,
      onboarding_step: 'awaiting_dob',
    });
    return {
      response: t(lang, 'ask_dob_after_name').replace('{name}', name),
      messageType: 'onboarding',
    };
  }

  // Couldn't parse anything — ask again
  return { response: t(lang, 'welcome'), messageType: 'greeting' };
}

async function handleDob(user, messageText, lang) {
  const parsed = parseMultiField(messageText);
  const name = user.display_name || 'friend';

  if (parsed.date) {
    // Check if time is also included
    if (parsed.time) {
      await updateUser(user.id, {
        birth_date: parsed.date,
        birth_time: parsed.time.time,
        birth_time_known: parsed.time.known,
        onboarding_step: 'awaiting_place',
      });
      return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
    }

    await updateUser(user.id, {
      birth_date: parsed.date,
      onboarding_step: 'awaiting_time',
    });
    return { response: t(lang, 'ask_time'), messageType: 'onboarding' };
  }

  return { response: t(lang, 'invalid_date'), messageType: 'simple' };
}

async function handleTime(user, messageText, lang) {
  const parsed = parseMultiField(messageText);

  // Check if user gave time + place together
  if (parsed.time && parsed.place) {
    return handleTimeAndPlace(user, parsed.time, parsed.place, lang);
  }

  if (parsed.time) {
    await updateUser(user.id, {
      birth_time: parsed.time.time,
      birth_time_known: parsed.time.known,
      onboarding_step: 'awaiting_place',
    });
    return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  // Try parsing as just a time
  const time = parseTime(messageText);
  if (time) {
    await updateUser(user.id, {
      birth_time: time.time,
      birth_time_known: time.known,
      onboarding_step: 'awaiting_place',
    });
    return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
  }

  return { response: t(lang, 'invalid_time'), messageType: 'simple' };
}

async function handlePlace(user, messageText, lang) {
  const place = messageText.trim();
  if (place.length < 2) {
    return { response: t(lang, 'ask_place'), messageType: 'simple' };
  }

  return generateChartFromPlace(user, place, lang);
}

async function handleTimeAndPlace(user, time, place, lang) {
  await updateUser(user.id, {
    birth_time: time.time,
    birth_time_known: time.known,
  });
  user.birth_time = time.time;
  user.birth_time_known = time.known;

  return generateChartFromPlace(user, place, lang);
}

async function generateChartFromPlace(user, place, lang) {
  const name = user.display_name || 'friend';

  const geo = await geocodeBirthPlace(place);
  if (!geo) {
    return { response: t(lang, 'geocode_failed'), messageType: 'simple' };
  }

  try {
    const birthTime = (user.birth_time || '12:00').slice(0, 5);
    const birthDate = typeof user.birth_date === 'string'
      ? user.birth_date.split('T')[0]
      : String(user.birth_date);

    const chartData = generateBirthChart(
      birthDate, birthTime, geo.lat, geo.lng, geo.timezone, geo.formattedPlace
    );

    if (!chartData || chartData.moonSign === 'Unknown') {
      return { response: t(lang, 'chart_failed'), messageType: 'simple' };
    }

    await updateUser(user.id, {
      birth_place: geo.formattedPlace,
      birth_lat: geo.lat,
      birth_lng: geo.lng,
      birth_timezone: geo.timezone,
      chart_data: JSON.stringify(chartData),
      onboarding_step: 'onboarded',
      is_onboarded: true,
    });

    const overview = formatChartOverview(chartData, lang, name);
    return { response: overview, messageType: 'reading' };
  } catch (err) {
    logger.error({ err: err.message, userId: user.id }, 'Chart generation failed');
    return { response: t(lang, 'chart_failed'), messageType: 'simple' };
  }
}

// --- Smart multi-field parser ---

function parseMultiField(text) {
  const result = { name: null, date: null, time: null, place: null };
  let remaining = text.trim();

  // Try to extract date first
  const dateResult = extractDate(remaining);
  if (dateResult) {
    result.date = dateResult.date;
    remaining = dateResult.remaining.trim();
  }

  // Try to extract time
  const timeResult = extractTime(remaining);
  if (timeResult) {
    result.time = timeResult.time;
    remaining = timeResult.remaining.trim();
  }

  // Whatever's left might be name and/or place
  if (remaining.length > 0) {
    // If we already have date, remaining is likely name or place
    if (result.date) {
      // If it looks like a place (known city or short word after comma)
      const parts = remaining.split(/[,\s]+/).filter(p => p.length > 1);
      if (parts.length > 0) {
        // First non-date part is probably the name
        result.name = extractName(parts.join(' '));
      }
    } else {
      result.name = extractName(remaining);
    }
  }

  return result;
}

function extractDate(text) {
  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (slashMatch) {
    const [full, day, month, year] = slashMatch;
    const d = new Date(year, month - 1, day);
    if (isValidDate(d, day, month, year)) {
      return { date: formatDate(d), remaining: text.replace(full, '') };
    }
  }

  // "15 March 1990" or "March 15, 1990" etc.
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

function extractTime(text) {
  const time = parseTime(text);
  if (!time) return null;

  // Remove the matched time portion from text
  let remaining = text;

  // Remove AM/PM time patterns
  remaining = remaining.replace(/\d{1,2}:\d{2}\s*(am|pm)/i, '');
  remaining = remaining.replace(/\d{1,2}\s*(am|pm)/i, '');
  // Remove time-of-day words
  remaining = remaining.replace(/(morning|evening|afternoon|night|kaalaiyil|kaalai|maalai|subah|shaam|raat)/gi, '');
  remaining = remaining.replace(/\d{1,2}:\d{2}/, '');

  return { time, remaining: remaining.trim() };
}

function parseTime(text) {
  const lower = text.toLowerCase().trim();

  // Unknown time
  const unknownPhrases = ['theriyaadhu', 'theriyathu', 'therla', "don't know",
    'dont know', 'not sure', 'pata nahi', 'malum nahi', 'teliyadu', 'no idea',
    'ariyilla', 'gottilla', 'jani na', 'தெரியாது', 'पता नहीं', 'no worries',
    'తెలియదు', 'അറിയില്ല', 'ಗೊತ್ತಿಲ್ಲ', 'জানি না', 'unknown', 'nahi pata',
    'paravala', 'parledu', 'koi baat nahi', 'chalega'];
  if (unknownPhrases.some(p => lower.includes(p))) {
    return { time: '12:00:00', known: false };
  }

  // HH:MM AM/PM
  const ampmMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (ampmMatch) {
    let [, hours, minutes, period] = ampmMatch;
    hours = parseInt(hours);
    minutes = parseInt(minutes || '0');
    if (period.toLowerCase() === 'pm' && hours !== 12) hours += 12;
    if (period.toLowerCase() === 'am' && hours === 12) hours = 0;
    return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, known: true };
  }

  // 24-hour format HH:MM
  const h24Match = lower.match(/(\d{1,2}):(\d{2})/);
  if (h24Match) {
    const hours = parseInt(h24Match[1]);
    const minutes = parseInt(h24Match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`, known: true };
    }
  }

  // Time-of-day words with number
  const morningWords = ['kaalaiyil', 'kaalai', 'morning', 'subah', 'subha', 'ravile', 'udayam', 'beligge', 'sokal'];
  const eveningWords = ['maalai', 'evening', 'saam', 'shaam', 'sanje', 'bikel'];
  const afternoonWords = ['madhiyaanam', 'afternoon', 'dopahar', 'dupur'];
  const nightWords = ['night', 'iravu', 'raat', 'raatri', 'rathri'];

  const numMatch = lower.match(/(\d{1,2})/);
  if (numMatch) {
    let hours = parseInt(numMatch[1]);
    if (morningWords.some(w => lower.includes(w)) && hours <= 12) {
      return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true };
    }
    if (afternoonWords.some(w => lower.includes(w))) {
      if (hours < 12) hours += 12;
      return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true };
    }
    if (eveningWords.some(w => lower.includes(w))) {
      if (hours < 12) hours += 12;
      return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true };
    }
    if (nightWords.some(w => lower.includes(w))) {
      if (hours < 12) hours += 12;
      return { time: `${String(hours).padStart(2, '0')}:00:00`, known: true };
    }
  }

  // Just time-of-day words without number
  if (morningWords.some(w => lower.includes(w))) return { time: '08:00:00', known: false };
  if (afternoonWords.some(w => lower.includes(w))) return { time: '12:00:00', known: false };
  if (eveningWords.some(w => lower.includes(w))) return { time: '17:00:00', known: false };
  if (nightWords.some(w => lower.includes(w))) return { time: '21:00:00', known: false };

  return null;
}

// --- Helpers ---

function classifyIntent(text) {
  const lower = text.toLowerCase();
  const careerWords = ['career', 'job', 'work', 'business', 'money', 'finance', 'salary',
    'promotion', 'naukri', 'paisa', 'velai', 'thozhil', 'udyogam', 'chakri'];
  const marriageWords = ['marriage', 'love', 'relationship', 'partner', 'husband', 'wife',
    'wedding', 'shaadi', 'shaadhi', 'pyar', 'thirumanam', 'kalyanam', 'pelli', 'biye', 'vivah'];
  const generalWords = ['chart', 'kundli', 'kundali', 'jathagam', 'jatakam', 'horoscope',
    'rasi', 'rashi', 'birth', 'general', 'full', 'complete', 'janam'];

  if (careerWords.some(w => lower.includes(w))) return 'career';
  if (marriageWords.some(w => lower.includes(w))) return 'marriage';
  if (generalWords.some(w => lower.includes(w))) return 'general';
  return 'general';
}

function extractName(text) {
  let name = text.trim()
    .replace(/^(my name is|i am|i'm|naam hai|mera naam|en peyar|naa peru|ente per|nan hesaru|amar naam)\s*/i, '')
    .replace(/^(name:|peyar:|peru:)\s*/i, '')
    .replace(/[,.]$/, '')
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
