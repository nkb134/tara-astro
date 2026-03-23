import { t, detectLanguage } from '../languages/index.js';
import { updateUser } from '../db/users.js';
import { geocodeBirthPlace } from '../jyotish/geocode.js';
import { generateBirthChart } from '../jyotish/vedastro.js';
import { formatChartOverview } from '../jyotish/chartFormatter.js';
import { logger } from '../utils/logger.js';

export async function processChartGeneration(chartInfo) {
  const { userId, birthDate, birthTime, lat, lng, timezone, placeName, lang, userName } = chartInfo;

  try {
    // Format birth time for API (strip seconds if present)
    const timeForApi = birthTime.slice(0, 5); // "HH:MM"
    // Format birth date for API
    const dateStr = typeof birthDate === 'string' ? birthDate.split('T')[0] : birthDate;

    const chartData = await generateBirthChart(dateStr, timeForApi, lat, lng, timezone, placeName);

    if (!chartData || !chartData.moonSign || chartData.moonSign === 'Unknown') {
      logger.error({ userId }, 'Chart generation returned incomplete data');
      return {
        success: false,
        response: t(lang, 'chart_failed'),
      };
    }

    // Save chart data to user
    await updateUser(userId, {
      chart_data: JSON.stringify(chartData),
      onboarding_step: 'onboarded',
      is_onboarded: true,
    });

    // Format the chart overview message
    const overview = formatChartOverview(chartData, lang, userName);

    return {
      success: true,
      response: overview,
    };
  } catch (err) {
    logger.error({ err: err.message, userId }, 'Chart generation failed');

    await updateUser(userId, {
      onboarding_step: 'awaiting_place',
    });

    return {
      success: false,
      response: t(lang, 'chart_failed'),
    };
  }
}

export async function handleOnboarding(user, messageText) {
  const step = user.onboarding_step || 'new';
  const lang = user.language || detectLanguage(messageText);

  switch (step) {
    case 'new':
      return await handleNewUser(user, messageText);
    case 'awaiting_intent':
      return await handleIntent(user, messageText, lang);
    case 'awaiting_name':
      return await handleName(user, messageText, lang);
    case 'awaiting_dob':
      return await handleDob(user, messageText, lang);
    case 'awaiting_time':
      return await handleTime(user, messageText, lang);
    case 'awaiting_place':
      return await handlePlace(user, messageText, lang);
    case 'generating_chart':
      return { response: t(lang, 'generating_chart').replace('{name}', user.display_name || 'friend'), messageType: 'simple' };
    default:
      return { response: t(lang, 'welcome'), messageType: 'greeting' };
  }
}

async function handleNewUser(user, messageText) {
  const lang = detectLanguage(messageText);

  await updateUser(user.id, {
    language: lang,
    onboarding_step: 'awaiting_intent',
  });

  return { response: t(lang, 'welcome'), messageType: 'greeting' };
}

async function handleIntent(user, messageText, lang) {
  const intent = classifyIntent(messageText);

  const intentKey = {
    career: 'ask_name_career',
    marriage: 'ask_name_marriage',
    general: 'ask_name_general',
  }[intent] || 'ask_name_default';

  await updateUser(user.id, {
    onboarding_step: 'awaiting_name',
    preferences: JSON.stringify({ ...(user.preferences || {}), initial_intent: intent }),
  });

  return { response: t(lang, intentKey), messageType: 'onboarding' };
}

async function handleName(user, messageText, lang) {
  const name = extractName(messageText);

  await updateUser(user.id, {
    display_name: name,
    onboarding_step: 'awaiting_dob',
  });

  const response = t(lang, 'greet_name_ask_dob').replace('{name}', name);
  return { response, messageType: 'onboarding' };
}

async function handleDob(user, messageText, lang) {
  const parsed = parseDate(messageText);

  if (!parsed) {
    return { response: t(lang, 'invalid_date'), messageType: 'simple' };
  }

  await updateUser(user.id, {
    birth_date: parsed,
    onboarding_step: 'awaiting_time',
  });

  return { response: t(lang, 'ask_time'), messageType: 'onboarding' };
}

async function handleTime(user, messageText, lang) {
  const parsed = parseTime(messageText);

  if (!parsed) {
    return { response: t(lang, 'invalid_time'), messageType: 'simple' };
  }

  const timeKnown = parsed.known;

  await updateUser(user.id, {
    birth_time: parsed.time,
    birth_time_known: timeKnown,
    onboarding_step: 'awaiting_place',
  });

  return { response: t(lang, 'ask_place'), messageType: 'onboarding' };
}

async function handlePlace(user, messageText, lang) {
  const place = messageText.trim();

  if (place.length < 2) {
    return { response: t(lang, 'ask_place'), messageType: 'simple' };
  }

  const name = user.display_name || 'friend';

  // Step 1: Geocode the place
  const geo = await geocodeBirthPlace(place);
  if (!geo) {
    return { response: t(lang, 'geocode_failed'), messageType: 'simple' };
  }

  // Save place data immediately
  await updateUser(user.id, {
    birth_place: geo.formattedPlace,
    birth_lat: geo.lat,
    birth_lng: geo.lng,
    birth_timezone: geo.timezone,
    onboarding_step: 'generating_chart',
  });

  // Step 2: Generate chart (this takes a while due to API rate limits)
  // Return a preliminary message; chart generation happens async
  return {
    response: t(lang, 'generating_chart').replace('{name}', name),
    messageType: 'onboarding',
    pendingChartGeneration: {
      userId: user.id,
      birthDate: user.birth_date,
      birthTime: user.birth_time || '12:00',
      lat: geo.lat,
      lng: geo.lng,
      timezone: geo.timezone,
      placeName: geo.formattedPlace,
      lang,
      userName: name,
    },
  };
}

// --- Helper functions ---

function classifyIntent(text) {
  const lower = text.toLowerCase();

  const careerWords = ['career', 'job', 'work', 'business', 'money', 'finance', 'salary',
    'promotion', 'naukri', 'paisa', 'velai', 'thozhil', 'udyogam', 'chakri'];
  const marriageWords = ['marriage', 'love', 'relationship', 'partner', 'husband', 'wife',
    'wedding', 'shaadi', 'pyar', 'thirumanam', 'kalyanam', 'vivah', 'pellam', 'biye'];
  const generalWords = ['chart', 'kundli', 'jathagam', 'horoscope', 'rasi', 'birth',
    'general', 'full', 'complete', 'jaatakam', 'janam'];

  if (careerWords.some(w => lower.includes(w))) return 'career';
  if (marriageWords.some(w => lower.includes(w))) return 'marriage';
  if (generalWords.some(w => lower.includes(w))) return 'general';

  return 'general';
}

function extractName(text) {
  // Clean up common prefixes
  let name = text.trim()
    .replace(/^(my name is|i am|i'm|naam hai|en peyar|naa peru|ente per|nan hesaru|amar naam)\s*/i, '')
    .replace(/^(name:|peyar:|peru:)\s*/i, '')
    .trim();

  // Take first 2 words max (first + last name)
  const words = name.split(/\s+/).slice(0, 2);
  name = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  return name || text.trim();
}

function parseDate(text) {
  const cleaned = text.trim();

  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = cleaned.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const d = new Date(year, month - 1, day);
    if (isValidDate(d, day, month, year)) return formatDate(d);
  }

  // "15 March 1990" or "March 15, 1990"
  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };

  const namedMatch = cleaned.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i) ||
                      cleaned.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);

  if (namedMatch) {
    let day, monthStr, year;
    if (/^\d/.test(namedMatch[1])) {
      [, day, monthStr, year] = namedMatch;
    } else {
      [, monthStr, day, year] = namedMatch;
    }
    const month = months[monthStr.toLowerCase()];
    if (month) {
      const d = new Date(year, month - 1, day);
      if (isValidDate(d, day, month, year)) return formatDate(d);
    }
  }

  return null;
}

function isValidDate(d, day, month, year) {
  return d instanceof Date && !isNaN(d) &&
    d.getDate() === parseInt(day) &&
    d.getMonth() === parseInt(month) - 1 &&
    parseInt(year) >= 1920 && parseInt(year) <= 2015;
}

function formatDate(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD for PostgreSQL
}

function parseTime(text) {
  const lower = text.toLowerCase().trim();

  // Unknown time
  const unknownPhrases = ['theriyaadhu', 'theriyathu', 'therla', 'don\'t know',
    'dont know', 'not sure', 'pata nahi', 'malum nahi', 'teliyadu',
    'ariyilla', 'gottilla', 'jani na', 'தெரியாது', 'पता नहीं',
    'తెలియదు', 'അറിയില്ല', 'ಗೊತ್ತಿಲ್ಲ', 'জানি না', 'unknown', 'no idea'];
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

  // Tamil/Hindi time words with number
  const morningWords = ['kaalaiyil', 'kaalai', 'morning', 'subah', 'subha', 'ravile', 'udayam', 'beligge', 'sokal'];
  const eveningWords = ['maalai', 'evening', 'saam', 'shaam', 'sanjay', 'sayam', 'sanje', 'bikel'];
  const afternoonWords = ['madhiyaanam', 'madhyanam', 'afternoon', 'dopahar', 'madhyahnam', 'dupur'];
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

  // Approximate time words without number
  if (morningWords.some(w => lower.includes(w))) return { time: '08:00:00', known: false };
  if (afternoonWords.some(w => lower.includes(w))) return { time: '12:00:00', known: false };
  if (eveningWords.some(w => lower.includes(w))) return { time: '17:00:00', known: false };
  if (nightWords.some(w => lower.includes(w))) return { time: '21:00:00', known: false };

  return null;
}
