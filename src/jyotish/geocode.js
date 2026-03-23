import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { find as findTimezone } from 'geo-tz';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

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

// Normalize place input
function normalize(place) {
  return place
    .toLowerCase()
    .trim()
    .replace(/\s*(district|city|town|taluk|tehsil|mandal|block)\s*/gi, '')
    .replace(/[,.\-]+$/, '')
    .trim();
}

export async function geocodeBirthPlace(placeString) {
  const normalized = normalize(placeString);

  // Layer 1: Check local India cities database (instant, no API call)
  const cities = getCities();
  const localResult = cities[normalized];
  if (localResult) {
    logger.info({ place: normalized, source: 'local' }, 'Geocoded from local database');
    return {
      lat: localResult.lat,
      lng: localResult.lng,
      timezone: localResult.tz || 'Asia/Kolkata',
      formattedPlace: `${placeString.trim()}, ${localResult.state || 'India'}`,
    };
  }

  // Also try common variations
  const variations = [
    normalized,
    normalized.replace(/pur$/, 'pura'),
    normalized.replace(/pura$/, 'pur'),
    normalized.replace(/nagar$/, 'nagara'),
    normalized.replace(/nagara$/, 'nagar'),
    normalized.replace(/bad$/, 'abad'),
    normalized.replace(/abad$/, 'bad'),
  ];

  for (const variant of variations) {
    if (variant !== normalized && cities[variant]) {
      logger.info({ place: variant, source: 'local-variant' }, 'Geocoded from local database (variant)');
      const r = cities[variant];
      return {
        lat: r.lat,
        lng: r.lng,
        timezone: r.tz || 'Asia/Kolkata',
        formattedPlace: `${placeString.trim()}, ${r.state || 'India'}`,
      };
    }
  }

  // Layer 2: OpenCage API fallback
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
      const timezone = timezones[0] || 'Asia/Kolkata';

      logger.info({ place: placeString, source: 'opencage' }, 'Geocoded from OpenCage');
      return {
        lat: Math.round(lat * 10000000) / 10000000,
        lng: Math.round(lng * 10000000) / 10000000,
        timezone,
        formattedPlace: result.formatted || placeString.trim(),
      };
    }
  } catch (err) {
    logger.error({ err: err.message, place: placeString }, 'OpenCage geocoding failed');
  }

  // Layer 3: Both failed
  logger.warn({ place: placeString }, 'Geocoding failed completely');
  return null;
}
