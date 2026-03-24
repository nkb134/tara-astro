import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const swe = require('swisseph');

import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set ephemeris path
swe.swe_set_ephe_path(path.join(__dirname, '../../node_modules/swisseph/ephe'));

// Use Lahiri ayanamsa (standard for Vedic/Indian astrology)
swe.swe_set_sid_mode(swe.SE_SIDM_LAHIRI, 0, 0);

// Planet IDs in Swiss Ephemeris
const PLANET_IDS = {
  Sun: swe.SE_SUN,
  Moon: swe.SE_MOON,
  Mars: swe.SE_MARS,
  Mercury: swe.SE_MERCURY,
  Jupiter: swe.SE_JUPITER,
  Venus: swe.SE_VENUS,
  Saturn: swe.SE_SATURN,
  Rahu: swe.SE_MEAN_NODE,   // Mean North Node
  Ketu: -1,                  // Calculated as Rahu + 180
};

// Zodiac signs
const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// Sign lords
const SIGN_LORDS = {
  Aries: 'Mars', Taurus: 'Venus', Gemini: 'Mercury', Cancer: 'Moon',
  Leo: 'Sun', Virgo: 'Mercury', Libra: 'Venus', Scorpio: 'Mars',
  Sagittarius: 'Jupiter', Capricorn: 'Saturn', Aquarius: 'Saturn', Pisces: 'Jupiter',
};

// 27 Nakshatras with lords (for Vimshottari Dasha)
const NAKSHATRAS = [
  { name: 'Ashwini', lord: 'Ketu' },
  { name: 'Bharani', lord: 'Venus' },
  { name: 'Krittika', lord: 'Sun' },
  { name: 'Rohini', lord: 'Moon' },
  { name: 'Mrigashira', lord: 'Mars' },
  { name: 'Ardra', lord: 'Rahu' },
  { name: 'Punarvasu', lord: 'Jupiter' },
  { name: 'Pushya', lord: 'Saturn' },
  { name: 'Ashlesha', lord: 'Mercury' },
  { name: 'Magha', lord: 'Ketu' },
  { name: 'Purva Phalguni', lord: 'Venus' },
  { name: 'Uttara Phalguni', lord: 'Sun' },
  { name: 'Hasta', lord: 'Moon' },
  { name: 'Chitra', lord: 'Mars' },
  { name: 'Swati', lord: 'Rahu' },
  { name: 'Vishakha', lord: 'Jupiter' },
  { name: 'Anuradha', lord: 'Saturn' },
  { name: 'Jyeshtha', lord: 'Mercury' },
  { name: 'Moola', lord: 'Ketu' },
  { name: 'Purva Ashadha', lord: 'Venus' },
  { name: 'Uttara Ashadha', lord: 'Sun' },
  { name: 'Shravana', lord: 'Moon' },
  { name: 'Dhanishta', lord: 'Mars' },
  { name: 'Shatabhisha', lord: 'Rahu' },
  { name: 'Purva Bhadrapada', lord: 'Jupiter' },
  { name: 'Uttara Bhadrapada', lord: 'Saturn' },
  { name: 'Revati', lord: 'Mercury' },
];

// Vimshottari Dasha periods (years)
const DASHA_YEARS = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7,
  Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
};
const DASHA_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
const TOTAL_DASHA_YEARS = 120;

// Exaltation and debilitation signs
const EXALTATION = {
  Sun: 'Aries', Moon: 'Taurus', Mars: 'Capricorn', Mercury: 'Virgo',
  Jupiter: 'Cancer', Venus: 'Pisces', Saturn: 'Libra',
};
const DEBILITATION = {
  Sun: 'Libra', Moon: 'Scorpio', Mars: 'Cancer', Mercury: 'Pisces',
  Jupiter: 'Capricorn', Venus: 'Virgo', Saturn: 'Aries',
};

// Own signs (Moolatrikona + own)
const OWN_SIGNS = {
  Sun: ['Leo'], Moon: ['Cancer'], Mars: ['Aries', 'Scorpio'],
  Mercury: ['Gemini', 'Virgo'], Jupiter: ['Sagittarius', 'Pisces'],
  Venus: ['Taurus', 'Libra'], Saturn: ['Capricorn', 'Aquarius'],
};

// ------- Core Functions -------

function dateToJulian(year, month, day, hour) {
  const result = swe.swe_julday(year, month, day, hour, swe.SE_GREG_CAL);
  return result;
}

function getSignFromLongitude(longitude) {
  const signIndex = Math.floor(longitude / 30) % 12;
  return SIGNS[signIndex];
}

function getDegreesInSign(longitude) {
  return longitude % 30;
}

function getNakshatra(longitude) {
  const nakshatraSpan = 360 / 27; // 13.333... degrees
  const nakshatraIndex = Math.floor(longitude / nakshatraSpan) % 27;
  const degreesInNakshatra = longitude % nakshatraSpan;
  const pada = Math.floor(degreesInNakshatra / (nakshatraSpan / 4)) + 1;

  return {
    index: nakshatraIndex,
    name: NAKSHATRAS[nakshatraIndex].name,
    lord: NAKSHATRAS[nakshatraIndex].lord,
    pada: Math.min(pada, 4),
  };
}

function getNavamshaSign(longitude) {
  // Navamsha: each sign divided into 9 parts of 3°20' (3.333°)
  const navamshaIndex = Math.floor(longitude / (10 / 3)) % 12;
  return SIGNS[navamshaIndex];
}

function getPlanetDignity(planet, sign) {
  if (EXALTATION[planet] === sign) return 'exalted';
  if (DEBILITATION[planet] === sign) return 'debilitated';
  if (OWN_SIGNS[planet]?.includes(sign)) return 'own';

  // Friend/enemy relationships (simplified)
  const lord = SIGN_LORDS[sign];
  const friends = FRIENDSHIP[planet];
  if (friends?.friends?.includes(lord)) return 'friend';
  if (friends?.enemies?.includes(lord)) return 'enemy';
  return 'neutral';
}

// Simplified friendship table
const FRIENDSHIP = {
  Sun: { friends: ['Moon', 'Mars', 'Jupiter'], enemies: ['Venus', 'Saturn'] },
  Moon: { friends: ['Sun', 'Mercury'], enemies: [] },
  Mars: { friends: ['Sun', 'Moon', 'Jupiter'], enemies: ['Mercury'] },
  Mercury: { friends: ['Sun', 'Venus'], enemies: ['Moon'] },
  Jupiter: { friends: ['Sun', 'Moon', 'Mars'], enemies: ['Mercury', 'Venus'] },
  Venus: { friends: ['Mercury', 'Saturn'], enemies: ['Sun', 'Moon'] },
  Saturn: { friends: ['Mercury', 'Venus'], enemies: ['Sun', 'Moon', 'Mars'] },
  Rahu: { friends: ['Venus', 'Saturn'], enemies: ['Sun', 'Moon', 'Mars'] },
  Ketu: { friends: ['Mars', 'Jupiter'], enemies: ['Venus', 'Saturn'] },
};

// ------- Vimshottari Dasha -------

function calculateVimshottariDasha(moonLongitude, birthJulian) {
  const nakshatra = getNakshatra(moonLongitude);
  const nakshatraLord = nakshatra.lord;
  const nakshatraSpan = 360 / 27;

  // How much of the nakshatra has been traversed
  const degreesInNakshatra = moonLongitude % nakshatraSpan;
  const fractionElapsed = degreesInNakshatra / nakshatraSpan;

  // Remaining years in the first dasha at birth
  const firstDashaTotal = DASHA_YEARS[nakshatraLord];
  const remainingYears = firstDashaTotal * (1 - fractionElapsed);

  // Build dasha sequence starting from nakshatra lord
  const startIndex = DASHA_ORDER.indexOf(nakshatraLord);
  const dashas = [];
  let currentJulian = birthJulian;

  for (let i = 0; i < 9; i++) {
    const idx = (startIndex + i) % 9;
    const lord = DASHA_ORDER[idx];
    const years = i === 0 ? remainingYears : DASHA_YEARS[lord];
    const startDate = julianToDate(currentJulian);
    currentJulian += years * 365.25;
    const endDate = julianToDate(currentJulian);

    dashas.push({
      lord,
      years: Math.round(years * 100) / 100,
      startDate,
      endDate,
      antardashas: calculateAntardashas(lord, julianToDate(currentJulian - years * 365.25), years),
    });
  }

  return dashas;
}

function calculateAntardashas(mahadashaLord, startDate, totalYears) {
  const startIndex = DASHA_ORDER.indexOf(mahadashaLord);
  const antardashas = [];
  let currentDays = 0;
  const totalDays = totalYears * 365.25;

  for (let i = 0; i < 9; i++) {
    const idx = (startIndex + i) % 9;
    const lord = DASHA_ORDER[idx];
    const proportion = (DASHA_YEARS[mahadashaLord] * DASHA_YEARS[lord]) / TOTAL_DASHA_YEARS;
    const days = (proportion / totalYears) * totalDays;

    const adStart = new Date(startDate);
    adStart.setDate(adStart.getDate() + Math.round(currentDays));
    currentDays += days;
    const adEnd = new Date(startDate);
    adEnd.setDate(adEnd.getDate() + Math.round(currentDays));

    antardashas.push({
      lord,
      startDate: adStart.toISOString().split('T')[0],
      endDate: adEnd.toISOString().split('T')[0],
    });
  }

  return antardashas;
}

function getCurrentDasha(dashas, currentDate) {
  const now = currentDate || new Date();

  for (const dasha of dashas) {
    const start = new Date(dasha.startDate);
    const end = new Date(dasha.endDate);
    if (now >= start && now <= end) {
      // Find current antardasha
      let currentAntardasha = null;
      for (const ad of dasha.antardashas) {
        const adStart = new Date(ad.startDate);
        const adEnd = new Date(ad.endDate);
        if (now >= adStart && now <= adEnd) {
          currentAntardasha = ad;
          break;
        }
      }
      return {
        mahadasha: dasha.lord,
        mahadashaStart: dasha.startDate,
        mahadashaEnd: dasha.endDate,
        antardasha: currentAntardasha?.lord || 'Unknown',
        antardashaStart: currentAntardasha?.startDate || '',
        antardashaEnd: currentAntardasha?.endDate || '',
      };
    }
  }

  return { mahadasha: 'Unknown', antardasha: 'Unknown' };
}

function julianToDate(jd) {
  const result = swe.swe_revjul(jd, swe.SE_GREG_CAL);
  const month = String(result.month).padStart(2, '0');
  const day = String(result.day).padStart(2, '0');
  return `${result.year}-${month}-${day}`;
}

// ------- Yoga Detection -------

function detectYogas(planets, houses) {
  const yogas = [];

  const moonSign = planets.Moon?.sign;
  const jupiterSign = planets.Jupiter?.sign;
  const moonHouse = planets.Moon?.houseNumber;
  const jupiterHouse = planets.Jupiter?.houseNumber;

  // Gajakesari Yoga: Jupiter in kendra from Moon
  if (moonHouse && jupiterHouse) {
    const diff = ((jupiterHouse - moonHouse) + 12) % 12;
    if ([0, 3, 6, 9].includes(diff)) {
      yogas.push({
        name: 'Gajakesari Yoga',
        description: 'Jupiter in kendra from Moon — wisdom, fame, and prosperity',
        planets: ['Moon', 'Jupiter'],
      });
    }
  }

  // Raj Yoga: Lord of kendra + lord of trikona conjunct or in mutual aspect
  const ascendantSign = houses.House1?.sign;
  if (ascendantSign) {
    const kendraHouses = [1, 4, 7, 10];
    const trikonaHouses = [1, 5, 9];
    const kendraLords = kendraHouses.map(h => houses[`House${h}`]?.lord).filter(Boolean);
    const trikonaLords = trikonaHouses.map(h => houses[`House${h}`]?.lord).filter(Boolean);

    for (const kl of kendraLords) {
      for (const tl of trikonaLords) {
        if (kl !== tl && planets[kl] && planets[tl] && planets[kl].sign === planets[tl].sign) {
          yogas.push({
            name: 'Raj Yoga',
            description: `${kl} (kendra lord) conjunct ${tl} (trikona lord) — power and success`,
            planets: [kl, tl],
          });
          break;
        }
      }
      if (yogas.some(y => y.name === 'Raj Yoga')) break;
    }
  }

  // Mangal Dosha (Kuja Dosha): Mars in 1, 2, 4, 7, 8, 12 from Lagna
  const marsHouse = planets.Mars?.houseNumber;
  if (marsHouse && [1, 2, 4, 7, 8, 12].includes(marsHouse)) {
    // Check for cancellation conditions
    const cancelled = isMangalDoshaCancelled(planets, marsHouse);
    yogas.push({
      name: 'Mangal Dosha',
      description: cancelled
        ? `Mars in house ${marsHouse} — Mangal Dosha present but with cancellation factors`
        : `Mars in house ${marsHouse} — Mangal Dosha present`,
      planets: ['Mars'],
      cancelled,
    });
  }

  // Kaal Sarp Dosha: All planets between Rahu and Ketu
  const rahuLong = planets.Rahu?.longitude;
  const ketuLong = planets.Ketu?.longitude;
  if (rahuLong !== undefined && ketuLong !== undefined) {
    const otherPlanets = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
    const allBetween = otherPlanets.every(p => {
      const pLong = planets[p]?.longitude;
      if (pLong === undefined) return false;
      return isLongitudeBetween(pLong, rahuLong, ketuLong) ||
             isLongitudeBetween(pLong, ketuLong, rahuLong);
    });

    // Check if all are on the same side
    const allOnRahuSide = otherPlanets.every(p =>
      isLongitudeBetween(planets[p]?.longitude, rahuLong, ketuLong)
    );
    const allOnKetuSide = otherPlanets.every(p =>
      isLongitudeBetween(planets[p]?.longitude, ketuLong, rahuLong)
    );

    if (allOnRahuSide || allOnKetuSide) {
      yogas.push({
        name: 'Kaal Sarp Yoga',
        description: 'All planets hemmed between Rahu-Ketu axis — karmic life pattern',
        planets: ['Rahu', 'Ketu'],
      });
    }
  }

  return yogas;
}

function isMangalDoshaCancelled(planets, marsHouse) {
  // Simplified cancellation: Mars in own sign or exalted
  if (planets.Mars?.dignity === 'exalted' || planets.Mars?.dignity === 'own') return true;
  // Jupiter aspects Mars house
  const jupiterHouse = planets.Jupiter?.houseNumber;
  if (jupiterHouse) {
    const jupiterAspects = [jupiterHouse, (jupiterHouse + 4) % 12 || 12, (jupiterHouse + 6) % 12 || 12, (jupiterHouse + 8) % 12 || 12];
    if (jupiterAspects.includes(marsHouse)) return true;
  }
  return false;
}

function isLongitudeBetween(testLong, startLong, endLong) {
  if (startLong < endLong) {
    return testLong >= startLong && testLong <= endLong;
  }
  // Wraps around 0°
  return testLong >= startLong || testLong <= endLong;
}

// ------- Main Entry Point -------

export function generateBirthChart(birthDate, birthTime, lat, lng, timezone, placeName) {
  const startTime = Date.now();

  try {
    // Parse inputs
    const [year, month, day] = birthDate.split('-').map(Number);
    const [hours, minutes] = birthTime.split(':').map(Number);

    // Convert local time to UT
    const offsetHours = getTimezoneOffsetHours(timezone, birthDate, birthTime);
    const utHour = hours + (minutes / 60) - offsetHours;

    const julianDay = dateToJulian(year, month, day, utHour);

    // Calculate planet positions (sidereal)
    const planets = {};
    const flags = swe.SEFLG_SIDEREAL | swe.SEFLG_SPEED;

    for (const [name, id] of Object.entries(PLANET_IDS)) {
      if (name === 'Ketu') continue; // Calculate from Rahu

      const result = swe.swe_calc_ut(julianDay, id, flags);
      if (result.error) {
        logger.warn({ planet: name, error: result.error }, 'Planet calculation error');
        continue;
      }

      let longitude = result.longitude;
      if (longitude < 0) longitude += 360;

      const sign = getSignFromLongitude(longitude);
      const degreesInSign = getDegreesInSign(longitude);
      const nakshatra = getNakshatra(longitude);
      const navamsha = getNavamshaSign(longitude);
      const dignity = getPlanetDignity(name, sign);

      planets[name] = {
        longitude,
        sign,
        signDegrees: Math.round(degreesInSign * 100) / 100,
        constellation: `${nakshatra.name} - ${nakshatra.pada}`,
        nakshatra,
        navamsha,
        retrograde: result.longitudeSpeed < 0,
        exalted: dignity === 'exalted',
        debilitated: dignity === 'debilitated',
        dignity,
        conjunctions: [],
        signLord: SIGN_LORDS[sign],
      };
    }

    // Calculate Ketu (180° from Rahu)
    if (planets.Rahu) {
      const ketuLong = (planets.Rahu.longitude + 180) % 360;
      const sign = getSignFromLongitude(ketuLong);
      const nakshatra = getNakshatra(ketuLong);
      planets.Ketu = {
        longitude: ketuLong,
        sign,
        signDegrees: Math.round(getDegreesInSign(ketuLong) * 100) / 100,
        constellation: `${nakshatra.name} - ${nakshatra.pada}`,
        nakshatra,
        navamsha: getNavamshaSign(ketuLong),
        retrograde: true, // Rahu/Ketu always retrograde
        exalted: false,
        debilitated: false,
        dignity: 'neutral',
        conjunctions: [],
        signLord: SIGN_LORDS[sign],
      };
    }

    // Calculate Ascendant (Lagna)
    const houseResult = swe.swe_houses(julianDay, lat, lng, 'W'); // W = Whole Sign
    let ascLongitude = houseResult.ascendant;

    // Apply ayanamsa to ascendant
    const ayanamsa = swe.swe_get_ayanamsa_ut(julianDay);
    ascLongitude = (ascLongitude - ayanamsa + 360) % 360;

    const ascendantSign = getSignFromLongitude(ascLongitude);

    // Build houses — Whole Sign for sign-based lordship, Bhava Chalit for planet placement
    // Most Indian astrologers use Bhava Chalit (Equal House from Asc degree) for "which house is planet in"
    const ascSignIndex = SIGNS.indexOf(ascendantSign);
    const houses = {};

    // Bhava Chalit cusps: each house spans 30° centered on asc degree
    // House 1 midpoint = ascLongitude, cusp starts at ascLongitude - 15°
    const bhavaCusps = [];
    for (let i = 0; i < 12; i++) {
      const cusp = (ascLongitude - 15 + i * 30 + 360) % 360;
      bhavaCusps.push(cusp);
    }

    for (let i = 0; i < 12; i++) {
      const houseNum = i + 1;
      const signIndex = (ascSignIndex + i) % 12;
      const sign = SIGNS[signIndex];
      const lord = SIGN_LORDS[sign];

      houses[`House${houseNum}`] = {
        sign,
        lord,
        planetsInHouse: [],
        constellation: '',
        strength: 'Average',
      };
    }

    // Assign planets to houses using Bhava Chalit (planet's longitude relative to house cusps)
    for (const [name, data] of Object.entries(planets)) {
      // Bhava Chalit placement: which 30° sector does the planet fall in?
      let bhavaHouse = 1;
      for (let i = 0; i < 12; i++) {
        const cuspStart = bhavaCusps[i];
        const cuspEnd = bhavaCusps[(i + 1) % 12];
        const pLong = data.longitude;

        let inHouse = false;
        if (cuspStart < cuspEnd) {
          inHouse = pLong >= cuspStart && pLong < cuspEnd;
        } else {
          // Wraps around 360°
          inHouse = pLong >= cuspStart || pLong < cuspEnd;
        }

        if (inHouse) {
          bhavaHouse = i + 1;
          break;
        }
      }

      data.house = `House${bhavaHouse}`;
      data.houseNumber = bhavaHouse;
      data.housesOwned = '';
      // Also store the Whole Sign house for reference
      const wsHouse = ((SIGNS.indexOf(data.sign) - ascSignIndex + 12) % 12) + 1;
      data.wholeSignHouse = wsHouse;

      // Find which houses this planet lords
      const ownedHouses = [];
      for (const [hName, hData] of Object.entries(houses)) {
        if (hData.lord === name) {
          ownedHouses.push(hName);
        }
      }
      data.housesOwned = ownedHouses.join(', ');

      houses[`House${bhavaHouse}`].planetsInHouse.push(name);
    }

    // Detect conjunctions
    for (const [name1, data1] of Object.entries(planets)) {
      for (const [name2, data2] of Object.entries(planets)) {
        if (name1 !== name2 && data1.sign === data2.sign) {
          if (!data1.conjunctions.includes(name2)) {
            data1.conjunctions.push(name2);
          }
        }
      }
    }

    // Detect combust planets (within certain degrees of Sun)
    const combustOrbs = { Moon: 12, Mars: 17, Mercury: 14, Jupiter: 11, Venus: 10, Saturn: 15 };
    const sunLong = planets.Sun?.longitude;
    if (sunLong !== undefined) {
      for (const [name, orb] of Object.entries(combustOrbs)) {
        if (planets[name]) {
          const diff = Math.abs(planets[name].longitude - sunLong);
          const angularDist = Math.min(diff, 360 - diff);
          planets[name].combust = angularDist < orb;
        }
      }
    }

    // Vargottama check (same sign in Rasi and Navamsha)
    for (const [name, data] of Object.entries(planets)) {
      data.vargottama = data.sign === data.navamsha;
    }

    // Power percentage (simplified based on dignity)
    for (const [name, data] of Object.entries(planets)) {
      let power = 50;
      if (data.dignity === 'exalted') power = 90;
      else if (data.dignity === 'own') power = 80;
      else if (data.dignity === 'friend') power = 65;
      else if (data.dignity === 'enemy') power = 35;
      else if (data.dignity === 'debilitated') power = 15;
      if (data.retrograde && name !== 'Rahu' && name !== 'Ketu') power += 5;
      if (data.vargottama) power += 10;
      if (data.combust) power -= 20;
      data.powerPercentage = Math.max(0, Math.min(100, power));
    }

    // Vimshottari Dasha
    const moonLong = planets.Moon?.longitude;
    let dashas = [];
    let currentDasha = { mahadasha: 'Unknown', antardasha: 'Unknown' };

    if (moonLong !== undefined) {
      dashas = calculateVimshottariDasha(moonLong, julianDay);
      currentDasha = getCurrentDasha(dashas);
    }

    // Yoga detection
    const yogas = detectYogas(planets, houses);

    // Build chart data (same format as vedastro.js output)
    const chartData = {
      planets,
      houses,
      ascendant: ascendantSign,
      ascendantDegrees: Math.round(getDegreesInSign(ascLongitude) * 100) / 100,
      moonSign: planets.Moon?.sign || 'Unknown',
      sunSign: planets.Sun?.sign || 'Unknown',
      nakshatra: planets.Moon?.nakshatra || { name: 'Unknown', pada: 0 },
      dasha: {
        current: currentDasha,
        all: dashas,
      },
      yogas,
      meta: {
        birthDate,
        birthTime,
        lat,
        lng,
        timezone,
        placeName,
        calculationEngine: 'SwissEphemeris',
        ayanamsa: 'Lahiri',
        houseSystem: 'BhavaChalit',
        calculationTimeMs: Date.now() - startTime,
      },
    };

    logger.info({ timeMs: chartData.meta.calculationTimeMs }, 'Chart generated via Swiss Ephemeris');

    return chartData;
  } catch (err) {
    logger.error({ err: err.message, birthDate, birthTime }, 'Swiss Ephemeris calculation failed');
    throw err;
  }
}

function getTimezoneOffsetHours(timezone, dateStr, timeStr) {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart) {
      const match = tzPart.value.match(/GMT([+-]?)(\d{1,2}):?(\d{2})?/);
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const h = parseInt(match[2]) || 0;
        const m = parseInt(match[3]) || 0;
        return sign * (h + m / 60);
      }
    }
  } catch {
    // fallback
  }
  return 5.5; // Default IST
}
