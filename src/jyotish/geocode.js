import axios from 'axios';
import { find as findTimezone } from 'geo-tz';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PLACE_ALIASES = {
  'kovai': 'Coimbatore, Tamil Nadu, India',
  'trichy': 'Tiruchirappalli, Tamil Nadu, India',
  'pondy': 'Puducherry, India',
  'pondicherry': 'Puducherry, India',
  'bombay': 'Mumbai, Maharashtra, India',
  'madras': 'Chennai, Tamil Nadu, India',
  'calcutta': 'Kolkata, West Bengal, India',
  'bangalore': 'Bengaluru, Karnataka, India',
  'baroda': 'Vadodara, Gujarat, India',
  'benares': 'Varanasi, Uttar Pradesh, India',
  'trivandrum': 'Thiruvananthapuram, Kerala, India',
  'calicut': 'Kozhikode, Kerala, India',
  'cochin': 'Kochi, Kerala, India',
};

export async function geocodeBirthPlace(placeString) {
  const normalized = placeString.trim().toLowerCase();
  const resolvedPlace = PLACE_ALIASES[normalized] || placeString.trim();

  try {
    const response = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
      params: {
        q: resolvedPlace,
        key: config.geocoding.apiKey,
        countrycode: 'in',
        limit: 1,
        no_annotations: 1,
        language: 'en',
      },
      timeout: 10000,
    });

    const results = response.data?.results;
    if (!results || results.length === 0) {
      logger.warn({ place: resolvedPlace }, 'Geocoding returned no results');
      return null;
    }

    const result = results[0];
    const lat = result.geometry.lat;
    const lng = result.geometry.lng;

    const timezones = findTimezone(lat, lng);
    const timezone = timezones[0] || 'Asia/Kolkata';

    const formattedPlace = result.formatted || resolvedPlace;

    return {
      lat: Math.round(lat * 10000000) / 10000000,
      lng: Math.round(lng * 10000000) / 10000000,
      timezone,
      formattedPlace,
    };
  } catch (err) {
    logger.error({ err: err.message, place: resolvedPlace }, 'Geocoding failed');
    return null;
  }
}
