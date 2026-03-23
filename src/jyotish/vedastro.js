import axios from 'axios';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/delay.js';

const BASE_URL = 'https://api.vedastro.org/api';
const PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];
const HOUSES = ['House1', 'House2', 'House3', 'House4', 'House5', 'House6',
                'House7', 'House8', 'House9', 'House10', 'House11', 'House12'];

// Rate limit: 5 calls/min on free tier, so we pace requests
const RATE_LIMIT_DELAY_MS = 13000; // ~4.6 calls/min to be safe

function buildLocationPath(place, lat, lng, time, date, timezone) {
  // time: "HH:MM", date: "YYYY-MM-DD", timezone: "Asia/Kolkata" -> "+05:30"
  const offset = getUtcOffset(timezone, date);
  const [year, month, day] = date.split('-');
  return `Location/${place}/${lat},${lng}/Time/${time}/${day}/${month}/${year}/${offset}`;
}

function getUtcOffset(timezone, dateStr) {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart) {
      // "GMT+5:30" -> "+05:30"
      const match = tzPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
      if (match) {
        const sign = match[1];
        const hours = match[2].padStart(2, '0');
        const minutes = (match[3] || '00').padStart(2, '0');
        return `${sign}${hours}:${minutes}`;
      }
    }
  } catch {
    // fallback
  }
  return '+05:30'; // Default to IST
}

async function callVedAstro(endpoint, retries = 1) {
  const url = `${BASE_URL}/${endpoint}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 30000 });
      const data = response.data;

      if (data.Status === 'Pass') {
        return data.Payload;
      }

      // Rate limit hit
      if (data.Payload && typeof data.Payload === 'string' && data.Payload.includes('rate limit')) {
        logger.warn('VedAstro rate limit hit, waiting...');
        await sleep(60000);
        continue;
      }

      logger.warn({ url, payload: data.Payload }, 'VedAstro API returned non-pass status');
      return null;
    } catch (err) {
      logger.error({ url, attempt, error: err.message }, 'VedAstro API call failed');
      if (attempt < retries) {
        await sleep(3000);
      }
    }
  }
  return null;
}

export async function generateBirthChart(birthDate, birthTime, lat, lng, timezone, placeName) {
  const locationPath = buildLocationPath(placeName, lat, lng, birthTime, birthDate, timezone);

  logger.info({ birthDate, placeName }, 'Generating birth chart via VedAstro');

  const chartData = {
    planets: {},
    houses: {},
    meta: { birthDate, birthTime, lat, lng, timezone, placeName },
  };

  // Fetch planet data (9 planets, rate limited)
  for (const planet of PLANETS) {
    const payload = await callVedAstro(
      `Calculate/AllPlanetData/PlanetName/${planet}/${locationPath}`
    );

    if (payload?.AllPlanetData) {
      const p = payload.AllPlanetData;
      chartData.planets[planet] = {
        sign: p.PlanetRasiD1Sign?.Name || 'Unknown',
        signDegrees: p.PlanetRasiD1Sign?.DegreesIn?.TotalDegrees || 0,
        constellation: p.PlanetConstellation || 'Unknown',
        house: p.HousePlanetOccupiesBasedOnSign || 'Unknown',
        navamsha: p.PlanetNavamshaD9Sign?.Name || 'Unknown',
        retrograde: p.IsPlanetRetrograde === 'True',
        exalted: p.IsPlanetExalted === 'True',
        debilitated: p.IsPlanetDebilitated === 'True',
        conjunctions: p.PlanetsInConjunction || [],
        housesOwned: p.HousesOwnedByPlanet || '',
        signLord: p.PlanetLordOfZodiacSign?.Name || 'Unknown',
        powerPercentage: parseFloat(p.PlanetPowerPercentage || '0'),
        vargottama: p.IsPlanetVargottama === 'True',
        combust: p.IsPlanetCombust === 'True',
      };
    } else {
      chartData.planets[planet] = { sign: 'Unknown', error: true };
    }

    // Rate limiting delay between calls
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Fetch house data (12 houses)
  for (const house of HOUSES) {
    const payload = await callVedAstro(
      `Calculate/AllHouseData/HouseName/${house}/${locationPath}`
    );

    if (payload?.AllHouseData) {
      const h = payload.AllHouseData;
      chartData.houses[house] = {
        sign: h.HouseSignName || h.HouseRasiSign?.Name || 'Unknown',
        lord: h.LordOfHouse?.Name || 'Unknown',
        planetsInHouse: h.PlanetsInHouseBasedOnSign || [],
        constellation: h.HouseConstellation || 'Unknown',
        strength: h.HouseStrengthCategory || 'Unknown',
      };
    } else {
      chartData.houses[house] = { sign: 'Unknown', error: true };
    }

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Derive key chart features
  chartData.ascendant = chartData.houses.House1?.sign || 'Unknown';
  chartData.moonSign = chartData.planets.Moon?.sign || 'Unknown';
  chartData.sunSign = chartData.planets.Sun?.sign || 'Unknown';
  chartData.nakshatra = parsePrimaryNakshatra(chartData.planets.Moon?.constellation);

  return chartData;
}

function parsePrimaryNakshatra(constellationStr) {
  if (!constellationStr || constellationStr === 'Unknown') return 'Unknown';
  // Format: "Pushyami - 4" (nakshatra - pada)
  const parts = constellationStr.split(' - ');
  return {
    name: parts[0]?.trim() || constellationStr,
    pada: parseInt(parts[1]?.trim()) || 0,
  };
}
