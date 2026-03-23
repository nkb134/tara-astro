import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import axios from 'axios';
import { find as findTimezone } from 'geo-tz';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load India cities database
let _cities = null;
function getCities() {
  if (!_cities) {
    try {
      const citiesPath = path.join(__dirname, '../../knowledge/india-cities.json');
      _cities = JSON.parse(fs.readFileSync(citiesPath, 'utf-8'));
    } catch {
      logger.warn('india-cities.json not found, using OpenCage only');
      _cities = {};
    }
  }
  return _cities;
}

// Bug 4: Common misspellings
const MISSPELLINGS = {
  'chattisgarh': 'chhattisgarh', 'chatisgarh': 'chhattisgarh',
  'tamilnadu': 'tamil nadu', 'tamil': 'tamil nadu',
  'utter pradesh': 'uttar pradesh', 'uttar': 'uttar pradesh',
  'karnatka': 'karnataka', 'karnata': 'karnataka',
  'maharastra': 'maharashtra', 'maharashtr': 'maharashtra',
  'andra pradesh': 'andhra pradesh', 'andhra': 'andhra pradesh',
  'gujrat': 'gujarat', 'rajastahn': 'rajasthan',
  'madhya': 'madhya pradesh', 'himachal': 'himachal pradesh',
  'west bengal': 'west bengal', 'bengal': 'west bengal',
  'jharkand': 'jharkhand', 'jharkhnd': 'jharkhand',
  'orissa': 'odisha', 'orrisa': 'odisha',
  'uttrakhand': 'uttarakhand', 'uttaranchal': 'uttarakhand',
};

// Words to strip from place input
const STRIP_WORDS = ['district', 'city', 'town', 'taluk', 'tehsil', 'mandal',
  'block', 'near', 'paas', 'ke', 'ka', 'ki', 'mein', 'in', 'se', 'from'];

function normalize(text) {
  return text.toLowerCase().trim()
    .replace(/[,.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWords(text) {
  const words = text.split(/\s+/);
  return words.filter(w => !STRIP_WORDS.includes(w) && w.length > 1).join(' ');
}

export async function geocodeBirthPlace(placeString) {
  const normalized = normalize(placeString);
  const stripped = stripWords(normalized);
  const cities = getCities();

  logger.info({ input: placeString, normalized, stripped }, '[GEOCODE] Lookup');

  // Bug 4: Split into parts and try each against DB
  const parts = stripped.split(/\s+/).filter(p => p.length > 1);

  // Strategy 1: Try full stripped string
  if (cities[stripped]) {
    return buildResult(cities[stripped], placeString);
  }

  // Strategy 2: Try each individual part
  for (const part of parts) {
    if (cities[part]) {
      return buildResult(cities[part], placeString);
    }
    // Try with misspelling correction
    const corrected = MISSPELLINGS[part];
    if (corrected && cities[corrected]) {
      return buildResult(cities[corrected], placeString);
    }
  }

  // Strategy 3: Try common name variations
  for (const part of parts) {
    const variations = [
      part,
      part.replace(/pur$/, 'pura'), part.replace(/pura$/, 'pur'),
      part.replace(/nagar$/, 'nagara'), part.replace(/nagara$/, 'nagar'),
      part.replace(/bad$/, 'abad'), part.replace(/abad$/, 'bad'),
      part.replace(/garh$/, 'gadh'), part.replace(/gadh$/, 'garh'),
    ];
    for (const v of variations) {
      if (v !== part && cities[v]) {
        return buildResult(cities[v], placeString);
      }
    }
  }

  // Strategy 4: OpenCage API fallback
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
      const result = results[0];
      const lat = result.geometry.lat;
      const lng = result.geometry.lng;
      const timezones = findTimezone(lat, lng);

      logger.info({ place: placeString, source: 'opencage' }, '[GEOCODE] OpenCage match');
      return {
        lat: Math.round(lat * 10000000) / 10000000,
        lng: Math.round(lng * 10000000) / 10000000,
        timezone: timezones[0] || 'Asia/Kolkata',
        formattedPlace: result.formatted || placeString.trim(),
      };
    }
  } catch (err) {
    logger.error({ err: err.message, place: placeString }, '[GEOCODE] OpenCage failed');
  }

  logger.warn({ place: placeString, partsSearched: parts }, '[GEOCODE] All strategies failed');
  return null;
}

function buildResult(cityData, originalInput) {
  logger.info({ place: originalInput, source: 'local' }, '[GEOCODE] Local DB match');
  return {
    lat: cityData.lat,
    lng: cityData.lng,
    timezone: cityData.tz || 'Asia/Kolkata',
    formattedPlace: `${originalInput.trim()}, ${cityData.state || 'India'}`,
  };
}
