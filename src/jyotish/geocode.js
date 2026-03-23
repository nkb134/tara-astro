import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { find as findTimezone } from 'geo-tz';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '../../knowledge/geocache.json');

// Alias map for common alternate names
const ALIASES = {
  'kovai': 'coimbatore', 'madras': 'chennai', 'bombay': 'mumbai',
  'calcutta': 'kolkata', 'benares': 'varanasi', 'banaras': 'varanasi',
  'kashi': 'varanasi', 'trichy': 'tiruchirappalli', 'pondy': 'puducherry',
  'pondicherry': 'puducherry', 'baroda': 'vadodara', 'cochin': 'kochi',
  'calicut': 'kozhikode', 'poona': 'pune', 'cawnpore': 'kanpur',
  'simla': 'shimla', 'ooty': 'udhagamandalam', 'vizag': 'visakhapatnam',
  'bangalore': 'bengaluru', 'trivandrum': 'thiruvananthapuram',
  'mangalore': 'mangaluru', 'mysore': 'mysuru', 'hubli': 'hubballi',
  'belgaum': 'belagavi', 'gulbarga': 'kalaburagi',
  // Tamil script
  'சென்னை': 'chennai', 'மதுரை': 'madurai', 'கோவை': 'coimbatore',
  'திருச்சி': 'tiruchirappalli', 'சேலம்': 'salem',
  // Hindi script
  'दिल्ली': 'delhi', 'मुंबई': 'mumbai', 'कोलकाता': 'kolkata',
  'वाराणसी': 'varanasi', 'लखनऊ': 'lucknow', 'जयपुर': 'jaipur',
  // Telugu script
  'హైదరాబాద్': 'hyderabad', 'విజయవాడ': 'vijayawada',
  // Bengali script
  'কলকাতা': 'kolkata', 'হাওড়া': 'howrah',
};

// Words to strip from input
const STRIP_WORDS = ['district', 'city', 'town', 'taluk', 'tehsil', 'mandal',
  'block', 'near', 'paas', 'ke', 'ka', 'ki', 'se', 'from', 'in', 'mein',
  'wala', 'wali', 'ka', 'ki'];

// State misspellings
const STATE_FIXES = {
  'chattisgarh': 'chhattisgarh', 'chatisgarh': 'chhattisgarh',
  'tamilnadu': 'tamil nadu', 'utter pradesh': 'uttar pradesh',
  'karnatka': 'karnataka', 'maharastra': 'maharashtra',
  'andra pradesh': 'andhra pradesh', 'gujrat': 'gujarat',
  'rajastahn': 'rajasthan', 'jharkand': 'jharkhand',
  'orissa': 'odisha', 'uttrakhand': 'uttarakhand',
};

// Language → state prioritization
const LANG_STATE_MAP = {
  ta: 'Tamil Nadu', te: 'Telangana', kn: 'Karnataka',
  ml: 'Kerala', bn: 'West Bengal',
};

// --- Cache ---

let _cache = null;

function loadCache() {
  if (!_cache) {
    try {
      _cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    } catch {
      _cache = {};
    }
  }
  return _cache;
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2));
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to save geocache');
  }
}

function cacheHit(key) {
  const cache = loadCache();
  const entry = cache[key];
  if (entry && !entry.ambiguous) {
    entry.hits = (entry.hits || 0) + 1;
    return entry;
  }
  return null;
}

function cacheAmbiguous(key) {
  const cache = loadCache();
  const entry = cache[key];
  if (entry && entry.ambiguous) return entry;
  return null;
}

function addToCache(key, data) {
  const cache = loadCache();
  cache[key] = { ...data, hits: 1, added: new Date().toISOString().split('T')[0] };
  saveCache();
}

function addAmbiguousToCache(key, options) {
  const cache = loadCache();
  cache[key] = { ambiguous: true, options };
  saveCache();
}

// --- Normalize ---

function normalize(text) {
  let cleaned = text.toLowerCase().trim()
    .replace(/[,.\-;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Check aliases
  if (ALIASES[cleaned]) cleaned = ALIASES[cleaned];

  return cleaned;
}

function stripNoise(text) {
  return text.split(/\s+/)
    .filter(w => !STRIP_WORDS.includes(w) && w.length > 1)
    .join(' ');
}

function fixState(state) {
  const lower = state.toLowerCase();
  return STATE_FIXES[lower] || lower;
}

// --- Main export ---

export async function geocodeBirthPlace(placeString, userLang = 'en') {
  const normalized = normalize(placeString);
  const stripped = stripNoise(normalized);
  const parts = stripped.split(/\s+/).filter(p => p.length > 1);

  logger.info({ input: placeString, normalized, parts }, '[GEOCODE] Lookup');

  // Step 1: Check aliases for each part
  for (let i = 0; i < parts.length; i++) {
    if (ALIASES[parts[i]]) parts[i] = ALIASES[parts[i]];
  }

  // Step 2: Check local cache
  // Try full string, then each part
  const keysToTry = [stripped, ...parts];
  for (const key of keysToTry) {
    const hit = cacheHit(key);
    if (hit) {
      logger.info({ key, source: 'cache' }, '[GEOCODE] Cache hit');
      return buildResult(hit);
    }

    const ambig = cacheAmbiguous(key);
    if (ambig) {
      logger.info({ key, options: ambig.options.length }, '[GEOCODE] Ambiguous cache hit');
      // If user included state, try to resolve
      const stateHint = extractStateHint(parts, key);
      if (stateHint) {
        const match = ambig.options.find(o =>
          o.state.toLowerCase().includes(stateHint)
        );
        if (match) {
          logger.info({ resolved: match.formatted }, '[GEOCODE] Resolved ambiguity via state hint');
          return buildResult(match);
        }
      }
      // Language-based prioritization
      const langState = LANG_STATE_MAP[userLang];
      if (langState) {
        const langMatch = ambig.options.find(o =>
          o.state.toLowerCase() === langState.toLowerCase()
        );
        if (langMatch) {
          logger.info({ resolved: langMatch.formatted }, '[GEOCODE] Resolved via language hint');
          return buildResult(langMatch);
        }
      }
      // Return as disambiguation needed
      return { ambiguous: true, options: ambig.options };
    }
  }

  // Step 3: GeoNames API
  const geonamesResult = await callGeoNames(stripped, parts, userLang);
  if (geonamesResult) return geonamesResult;

  // Step 4: OpenCage fallback
  const opencageResult = await callOpenCage(placeString);
  if (opencageResult) return opencageResult;

  // Step 5: Failed
  logger.warn({ place: placeString }, '[GEOCODE] All strategies failed');
  return null;
}

function extractStateHint(parts, cityKey) {
  // If user typed "Jagdalpur Chhattisgarh", the non-city parts are the state hint
  const otherParts = parts.filter(p => p !== cityKey);
  if (otherParts.length > 0) {
    const combined = fixState(otherParts.join(' '));
    return combined;
  }
  return null;
}

// --- GeoNames API ---

async function callGeoNames(query, parts, userLang) {
  const username = config.geocoding.geonamesUsername;
  if (!username) {
    logger.warn('[GEOCODE] GEONAMES_USERNAME not set, skipping GeoNames');
    return null;
  }

  try {
    const response = await axios.get('http://api.geonames.org/searchJSON', {
      params: {
        q: query,
        country: 'IN',
        maxRows: 5,
        fuzzy: 0.8,
        featureClass: 'P',
        username,
      },
      timeout: 10000,
    });

    const results = response.data?.geonames || [];
    if (results.length === 0) return null;

    // Filter to meaningful population
    const withPop = results.filter(r => (r.population || 0) > 0);
    const meaningful = results.filter(r => (r.population || 0) > 5000);

    // Case F: User already included state — match by adminName1
    const stateHint = extractStateHint(parts, parts[0]);
    if (stateHint && results.length > 1) {
      const stateMatch = results.find(r =>
        r.adminName1?.toLowerCase().includes(stateHint) ||
        fixState(r.adminName1 || '').includes(stateHint)
      );
      if (stateMatch) {
        const entry = geonameToEntry(stateMatch);
        addToCache(parts[0], entry);
        logger.info({ place: entry.formatted, source: 'geonames+state' }, '[GEOCODE] Resolved');
        return buildResult(entry);
      }
    }

    // Case A: Single result with pop > 10000
    if (results.length === 1 || (withPop.length === 1 && withPop[0].population > 10000)) {
      const best = withPop[0] || results[0];
      const entry = geonameToEntry(best);
      addToCache(normalize(best.name), entry);
      logger.info({ place: entry.formatted, source: 'geonames' }, '[GEOCODE] Single result');
      return { ...buildResult(entry), confirm: true };
    }

    // Case B: Top result has 50x+ more population
    if (withPop.length >= 2) {
      const sorted = withPop.sort((a, b) => (b.population || 0) - (a.population || 0));
      if (sorted[0].population > sorted[1].population * 50) {
        const entry = geonameToEntry(sorted[0]);
        addToCache(normalize(sorted[0].name), entry);
        logger.info({ place: entry.formatted, source: 'geonames-dominant' }, '[GEOCODE] Dominant result');
        return { ...buildResult(entry), confirm: true };
      }
    }

    // Language-aware prioritization
    const langState = LANG_STATE_MAP[userLang];
    if (langState && meaningful.length >= 2) {
      const langMatch = meaningful.find(r =>
        r.adminName1?.toLowerCase() === langState.toLowerCase()
      );
      if (langMatch) {
        const entry = geonameToEntry(langMatch);
        addToCache(normalize(langMatch.name), entry);
        return { ...buildResult(entry), confirm: true };
      }
    }

    // Case C: 2-3 meaningful results
    if (meaningful.length >= 2 && meaningful.length <= 3) {
      const options = meaningful.map(geonameToEntry);
      addAmbiguousToCache(parts[0] || query, options);
      return { ambiguous: true, options };
    }

    // Case D: 4+ meaningful results
    if (meaningful.length > 3) {
      return { ambiguous: true, tooMany: true };
    }

    // Fallback: take the first result
    if (results.length > 0) {
      const entry = geonameToEntry(results[0]);
      addToCache(normalize(results[0].name), entry);
      return { ...buildResult(entry), confirm: true };
    }

    return null;
  } catch (err) {
    logger.error({ err: err.message }, '[GEOCODE] GeoNames API failed');
    return null;
  }
}

function geonameToEntry(r) {
  const tz = r.timezone?.timeZoneId || 'Asia/Kolkata';
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lng),
    state: r.adminName1 || 'India',
    timezone: tz,
    formatted: `${r.name}, ${r.adminName1 || 'India'}`,
    population: r.population || 0,
    geonameId: r.geonameId,
    source: 'geonames',
  };
}

// --- OpenCage fallback ---

async function callOpenCage(placeString) {
  if (!config.geocoding.apiKey) return null;

  try {
    const response = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
      params: {
        q: placeString.trim(),
        key: config.geocoding.apiKey,
        countrycode: 'in',
        limit: 1,
        no_annotations: 1,
        language: 'en',
      },
      timeout: 10000,
    });

    const results = response.data?.results;
    if (results && results.length > 0) {
      const r = results[0];
      const lat = r.geometry.lat;
      const lng = r.geometry.lng;
      const timezones = findTimezone(lat, lng);

      const entry = {
        lat: Math.round(lat * 1e7) / 1e7,
        lng: Math.round(lng * 1e7) / 1e7,
        state: r.components?.state || 'India',
        timezone: timezones[0] || 'Asia/Kolkata',
        formatted: r.formatted || placeString.trim(),
        population: 0,
        source: 'opencage',
      };

      // Cache the result
      addToCache(normalize(placeString), entry);
      logger.info({ place: entry.formatted, source: 'opencage' }, '[GEOCODE] OpenCage hit');
      return buildResult(entry);
    }
  } catch (err) {
    logger.error({ err: err.message }, '[GEOCODE] OpenCage failed');
  }
  return null;
}

// --- Helpers ---

function buildResult(entry) {
  return {
    lat: entry.lat,
    lng: entry.lng,
    timezone: entry.timezone || 'Asia/Kolkata',
    formattedPlace: entry.formatted || 'India',
  };
}
