/**
 * RAG — Deterministic Jyotish Knowledge Retrieval
 *
 * Loads structured JSON knowledge bases at startup.
 * Retrieves relevant context based on chart data + intent.
 * No embeddings, no Pinecone — pure lookup by planet/house/yoga/dasha.
 *
 * Returns a contextBlock string to inject into agent prompts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../../knowledge/jyotish');

// Lazy-loaded knowledge bases (loaded once on first access)
let _bhriguSutras = null;
let _yogas = null;
let _dashas = null;
let _remedies = null;
let _temples = null;
let _nadi = null;
let _planetInSign = null;
let _nakshatras = null;

function loadJSON(filename) {
  try {
    const filePath = path.join(KNOWLEDGE_DIR, filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    logger.warn({ err: err.message, file: filename }, 'Failed to load knowledge base');
    return [];
  }
}

function getBhriguSutras() {
  if (!_bhriguSutras) _bhriguSutras = loadJSON('bhrigu-sutras.json');
  return _bhriguSutras;
}

function getYogas() {
  if (!_yogas) _yogas = loadJSON('yogas.json');
  return _yogas;
}

function getDashas() {
  if (!_dashas) _dashas = loadJSON('dashas.json');
  return _dashas;
}

function getRemedies() {
  if (!_remedies) _remedies = loadJSON('remedies.json');
  return _remedies;
}

function getTemples() {
  if (!_temples) _temples = loadJSON('navagraha-temples.json');
  return _temples;
}

function getNadi() {
  if (!_nadi) _nadi = loadJSON('nadi-principles.json');
  return _nadi;
}

function getPlanetInSign() {
  if (!_planetInSign) _planetInSign = loadJSON('planet-in-sign.json');
  return _planetInSign;
}

function getNakshatras() {
  if (!_nakshatras) _nakshatras = loadJSON('nakshatras.json');
  return _nakshatras;
}

// House groups by topic
const TOPIC_HOUSES = {
  career: [2, 6, 10, 11],
  marriage: [5, 7, 8],
  relationship: [5, 7, 8],
  children: [5, 9],
  health: [1, 6, 8, 12],
  finance: [2, 5, 11],
  education: [4, 5, 9],
  general: [1, 5, 7, 9, 10],
};

/**
 * Main retrieval function.
 * @param {Object} chartData — parsed chart data (planets, houses, yogas, dasha)
 * @param {string} intent — agent type: 'reading', 'remedy'
 * @param {string} topic — topic keyword: 'career', 'marriage', 'health', etc.
 * @param {string} lang — user language code: 'hi', 'ta', 'en', etc.
 * @returns {{ contextBlock: string, sources: string[] }}
 */
export function retrieveJyotishContext(chartData, intent, topic, lang) {
  if (!chartData) return { contextBlock: '', sources: [] };

  const chunks = [];
  const sources = [];

  try {
    const planets = chartData.planets || {};
    const houses = chartData.houses || {};
    const yogas = chartData.yogas || [];
    const dasha = chartData.dasha?.current || {};

    // Determine relevant houses based on topic
    const topicKey = normalizeTopicKey(topic);
    const relevantHouses = TOPIC_HOUSES[topicKey] || TOPIC_HOUSES.general;

    // 1. Bhrigu Sutras — planet-in-house interpretations for relevant houses
    const bhrigu = getBhriguSutras();
    if (bhrigu.length > 0) {
      const bhriguChunks = findRelevantBhriguSutras(bhrigu, planets, relevantHouses, topicKey);
      for (const entry of bhriguChunks.slice(0, 3)) { // Max 3 entries
        const topicField = getTopicField(entry, topicKey);
        chunks.push(`[Bhrigu Sutras] ${entry.planet} in ${ordinal(entry.house)} house: ${entry.interpretation}${topicField ? ' ' + topicField : ''}`);
        sources.push(`bhrigu-sutras:${entry.planet}-h${entry.house}`);
      }
    }

    // 1.5. Planet-in-sign — dignity-based interpretations for special placements
    const signDB = getPlanetInSign();
    if (signDB.length > 0) {
      const signChunks = findRelevantPlanetInSign(signDB, planets, topicKey);
      for (const entry of signChunks.slice(0, 2)) { // Max 2 entries (only special dignities)
        const topicField = getTopicField(entry, topicKey);
        const dignityLabel = entry.dignity ? ` (${entry.dignity})` : '';
        chunks.push(`[Planet-in-Sign] ${entry.planet} in ${entry.sign}${dignityLabel}: ${entry.interpretation}${topicField ? ' ' + topicField : ''}`);
        sources.push(`planet-sign:${entry.planet}-${entry.sign}`);
      }
    }

    // 2. Yoga matching — match chart yogas against our database
    const yogaDB = getYogas();
    if (yogaDB.length > 0 && yogas.length > 0) {
      const matchedYogas = matchYogas(yogaDB, yogas);
      for (const yoga of matchedYogas.slice(0, 2)) { // Max 2 yogas
        chunks.push(`[${yoga.source || 'Classical Yoga'}] ${yoga.name}: ${yoga.effects}`);
        sources.push(`yoga:${yoga.name}`);
      }
    }

    // 2.5. Nakshatra — if chart has nakshatra data, match it
    const nakshatraDB = getNakshatras();
    const chartNakshatra = chartData.nakshatra?.name || chartData.moonNakshatra;
    if (nakshatraDB.length > 0 && chartNakshatra) {
      const nakshatraEntry = nakshatraDB.find(n =>
        n.name.toLowerCase() === chartNakshatra.toLowerCase()
      );
      if (nakshatraEntry) {
        let nText = `[Nakshatra] ${nakshatraEntry.name} (ruled by ${nakshatraEntry.ruler}): ${nakshatraEntry.personality}`;
        if (topicKey === 'career' && nakshatraEntry.careerStrengths) nText += ` ${nakshatraEntry.careerStrengths}`;
        if (topicKey === 'marriage' && nakshatraEntry.relationshipStyle) nText += ` ${nakshatraEntry.relationshipStyle}`;
        chunks.push(nText);
        sources.push(`nakshatra:${nakshatraEntry.name}`);
      }
    }

    // 3. Dasha interpretation — match current mahadasha/antardasha
    const dashaDB = getDashas();
    if (dashaDB.length > 0 && dasha.mahadasha) {
      const dashaChunk = findDashaContext(dashaDB, dasha, topicKey);
      if (dashaChunk) {
        chunks.push(dashaChunk.text);
        sources.push(dashaChunk.source);
      }
    }

    // 4. Remedies — for afflicted planets (remedy agent) or weak planets (reading agent)
    const remedyDB = getRemedies();
    if (remedyDB.length > 0) {
      const afflicted = findAfflictedPlanets(planets);
      if (intent === 'remedy' || afflicted.length > 0) {
        const remedyChunks = findRemedies(remedyDB, afflicted, intent === 'remedy');
        for (const rem of remedyChunks.slice(0, 2)) { // Max 2 remedies
          chunks.push(rem.text);
          sources.push(rem.source);
        }
      }
    }

    // 5. Nadi principles — planet-pair combinations + karmic + timing
    const nadiDB = getNadi();
    if (nadiDB.length > 0) {
      const nadiChunks = findNadiPrinciples(nadiDB, planets, dasha, topicKey);
      for (const n of nadiChunks.slice(0, 2)) { // Max 2 Nadi entries
        chunks.push(n.text);
        sources.push(n.source);
      }
    }

    // 6. Tamil temple recommendations (only for Tamil users)
    if (lang === 'ta' && (intent === 'remedy' || topicKey === 'general')) {
      const temples = getTemples();
      if (temples.length > 0) {
        const afflicted = findAfflictedPlanets(planets);
        const templeChunks = findTempleRecommendations(temples, afflicted, dasha);
        for (const t of templeChunks.slice(0, 2)) {
          chunks.push(t.text);
          sources.push(t.source);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'RAG retrieval error, returning partial results');
  }

  // Build final context block, capped at ~3200 chars (~800 tokens)
  let contextBlock = chunks.join('\n\n');
  if (contextBlock.length > 3200) {
    contextBlock = contextBlock.substring(0, 3200) + '...';
  }

  return { contextBlock, sources };
}

// ── Helper Functions ────────────────────────────────────────

function normalizeTopicKey(topic) {
  if (!topic) return 'general';
  const lower = (topic || '').toLowerCase();
  if (lower.includes('career') || lower.includes('job') || lower.includes('work') || lower.includes('naukri')) return 'career';
  if (lower.includes('marriage') || lower.includes('shaadi') || lower.includes('partner') || lower.includes('love') || lower.includes('relationship')) return 'marriage';
  if (lower.includes('child') || lower.includes('baby') || lower.includes('bachch') || lower.includes('santan')) return 'children';
  if (lower.includes('health') || lower.includes('sehat') || lower.includes('disease')) return 'health';
  if (lower.includes('money') || lower.includes('finance') || lower.includes('wealth') || lower.includes('paisa')) return 'finance';
  if (lower.includes('education') || lower.includes('study') || lower.includes('exam')) return 'education';
  return 'general';
}

function findRelevantBhriguSutras(bhrigu, planets, relevantHouses, topicKey) {
  const results = [];

  for (const [planetName, planetData] of Object.entries(planets)) {
    const house = planetData.house;
    if (!house) continue;

    // Prioritize: planets in relevant houses + afflicted/special planets
    const isRelevantHouse = relevantHouses.includes(house);
    const isSpecial = planetData.exalted || planetData.debilitated || planetData.retrograde || planetData.combust;

    if (isRelevantHouse || isSpecial) {
      const entry = bhrigu.find(b =>
        b.planet.toLowerCase() === planetName.toLowerCase() && b.house === house
      );
      if (entry) {
        // Score: relevant house + special condition = higher priority
        entry._score = (isRelevantHouse ? 10 : 0) + (isSpecial ? 5 : 0);
        results.push(entry);
      }
    }
  }

  // Sort by score (most relevant first)
  results.sort((a, b) => (b._score || 0) - (a._score || 0));
  return results;
}

function findRelevantPlanetInSign(signDB, planets, topicKey) {
  const results = [];
  const specialDignities = ['exalted', 'debilitated', 'own_sign', 'moolatrikona'];

  for (const [planetName, planetData] of Object.entries(planets)) {
    if (!planetData.sign) continue;

    const entry = signDB.find(s =>
      s.planet.toLowerCase() === planetName.toLowerCase() &&
      s.sign.toLowerCase() === planetData.sign.toLowerCase()
    );

    if (entry && specialDignities.includes(entry.dignity)) {
      // Only include planets with special dignity (exalted/debilitated/own sign)
      entry._score = entry.dignity === 'exalted' ? 10 :
                     entry.dignity === 'debilitated' ? 9 :
                     entry.dignity === 'own_sign' ? 7 : 5;
      results.push(entry);
    }
  }

  results.sort((a, b) => (b._score || 0) - (a._score || 0));
  return results;
}

function matchYogas(yogaDB, chartYogas) {
  const matched = [];
  for (const chartYoga of chartYogas) {
    const name = (chartYoga.name || chartYoga).toLowerCase();
    const dbEntry = yogaDB.find(y =>
      y.name.toLowerCase() === name ||
      (y.aliases || []).some(a => a.toLowerCase() === name)
    );
    if (dbEntry) matched.push(dbEntry);
  }
  return matched;
}

function findDashaContext(dashaDB, currentDasha, topicKey) {
  const mahadashaName = (currentDasha.mahadasha || '').replace(/\s+mahadasha/i, '').trim();
  const antardashaName = (currentDasha.antardasha || '').replace(/\s+antardasha/i, '').trim();

  const entry = dashaDB.find(d => d.planet.toLowerCase() === mahadashaName.toLowerCase());
  if (!entry) return null;

  let text = `[Dasha] ${entry.planet} Mahadasha (${entry.duration}): ${entry.generalEffect}`;

  // Add topic-specific dasha effect
  const topicEffect = entry[topicKey] || entry.career;
  if (topicEffect) {
    text += ` ${topicEffect}`;
  }

  // Add antardasha if available
  if (antardashaName && entry.antardasha) {
    const antara = entry.antardasha[antardashaName];
    if (antara) {
      text += ` Current sub-period (${antardashaName}): ${antara}`;
    }
  }

  return { text, source: `dasha:${entry.planet}-${antardashaName || 'general'}` };
}

function findAfflictedPlanets(planets) {
  const afflicted = [];
  for (const [name, data] of Object.entries(planets)) {
    if (data.debilitated || data.combust) {
      afflicted.push({ name, reason: data.debilitated ? 'debilitated' : 'combust' });
    }
  }
  // If none afflicted, check for retrograde or planets in dusthana houses
  if (afflicted.length === 0) {
    for (const [name, data] of Object.entries(planets)) {
      if (data.retrograde && [6, 8, 12].includes(data.house)) {
        afflicted.push({ name, reason: 'retrograde in dusthana' });
      }
    }
  }
  return afflicted;
}

function findRemedies(remedyDB, afflicted, isRemedyAgent) {
  const results = [];

  if (isRemedyAgent && afflicted.length === 0) {
    // Remedy agent but no afflicted planets — provide general remedy for dasha lord
    return [];
  }

  for (const aff of afflicted) {
    const entry = remedyDB.find(r => r.planet.toLowerCase() === aff.name.toLowerCase());
    if (entry) {
      const mantra = entry.mantra;
      const gem = entry.gemstone;
      let text = `[Remedy for ${entry.planet} — ${aff.reason}] `;
      text += `Mantra: "${mantra.text}" — ${mantra.count} times on ${mantra.day}.`;
      if (isRemedyAgent) {
        text += ` Gemstone: ${gem.primary} (budget: ${gem.budgetAlt}) on ${gem.finger} finger in ${gem.metal}.`;
        text += ` Fasting: ${entry.fasting.day}. Donation: ${entry.donation.items} to ${entry.donation.to}.`;
      }
      results.push({ text, source: `remedy:${entry.planet}` });
    }
  }

  return results;
}

function findTempleRecommendations(temples, afflicted, currentDasha) {
  const results = [];
  const planetsToRecommend = new Set();

  // Recommend temples for afflicted planets
  for (const aff of afflicted) {
    planetsToRecommend.add(aff.name.toLowerCase());
  }

  // Also recommend for current dasha planet
  const dashaLord = (currentDasha.mahadasha || '').replace(/\s+mahadasha/i, '').trim().toLowerCase();
  if (dashaLord) planetsToRecommend.add(dashaLord);

  for (const temple of temples) {
    if (planetsToRecommend.has(temple.planet.toLowerCase()) ||
        planetsToRecommend.has((temple.planetTa || '').toLowerCase()) ||
        planetsToRecommend.has((temple.planetHi || '').toLowerCase())) {
      let text = `[Navagraha Temple — ${temple.planet}] ${temple.temple}, ${temple.location}. `;
      text += `Best day: ${temple.bestDay}. Ritual: ${temple.ritual}. `;
      text += `${temple.specialNote}`;
      results.push({ text, source: `temple:${temple.planet}` });
    }
  }

  return results;
}

function findNadiPrinciples(nadiDB, planets, dasha, topicKey) {
  const results = [];
  const planetNames = Object.keys(planets).map(p => p.toLowerCase());

  // Find conjunctions (planets in same house)
  const houseOccupants = {};
  for (const [name, data] of Object.entries(planets)) {
    if (!data.house) continue;
    if (!houseOccupants[data.house]) houseOccupants[data.house] = [];
    houseOccupants[data.house].push(name);
  }

  // 1. Match planet-pair combinations from conjunctions
  for (const entry of nadiDB) {
    if (entry.type !== 'planet_pair' || !entry.planets || entry.planets.length < 2) continue;

    const p1 = entry.planets[0].toLowerCase();
    const p2 = entry.planets[1].toLowerCase();

    // Check if both planets exist in the chart
    if (!planetNames.includes(p1) || !planetNames.includes(p2)) continue;

    // Check if they're conjunct (same house) or if entry doesn't require conjunction
    const p1House = planets[Object.keys(planets).find(k => k.toLowerCase() === p1)]?.house;
    const p2House = planets[Object.keys(planets).find(k => k.toLowerCase() === p2)]?.house;

    if (p1House === p2House) {
      // Conjunct — high relevance
      const topicField = entry[topicKey + 'Effect'] || entry.careerEffect || '';
      let text = `[Nadi — ${entry.source}] ${entry.planets.join('-')} conjunction: ${entry.principle}`;
      if (topicField) text += ` ${topicField}`;
      results.push({ text, source: `nadi:${entry.planets.join('-')}`, score: 10 });
    }
  }

  // 2. Match karmic indicators (Rahu-Ketu axis, retrograde)
  for (const entry of nadiDB) {
    if (entry.type !== 'karmic') continue;

    // Check if entry's planets match chart
    if (entry.planets) {
      const allPresent = entry.planets.every(p => planetNames.includes(p.toLowerCase()));
      if (!allPresent) continue;
    }

    // Check house match
    if (entry.houses && entry.houses.length > 0) {
      const rahuHouse = planets.Rahu?.house;
      const ketuHouse = planets.Ketu?.house;
      if (rahuHouse && entry.houses.includes(rahuHouse)) {
        let text = `[Nadi Karmic — ${entry.source}] ${entry.principle}`;
        results.push({ text, source: `nadi-karmic:${entry.planets?.join('-') || 'axis'}`, score: 7 });
      }
    } else {
      // General karmic principle — always relevant
      let text = `[Nadi — ${entry.source}] ${entry.principle}`;
      results.push({ text, source: `nadi:${entry.type}`, score: 3 });
    }
  }

  // 3. Match timing principles (based on dasha planet)
  const dashaLord = (dasha.mahadasha || '').replace(/\s+mahadasha/i, '').trim().toLowerCase();
  for (const entry of nadiDB) {
    if (entry.type !== 'timing') continue;

    if (entry.planets?.some(p => p.toLowerCase() === dashaLord)) {
      let text = `[Nadi Timing — ${entry.source}] ${entry.principle}`;
      if (entry.timingNote) text += ` ${entry.timingNote}`;
      results.push({ text, source: `nadi-timing:${entry.planets?.join('-')}`, score: 5 });
    }
  }

  // Sort by relevance score
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results;
}

function getTopicField(entry, topicKey) {
  if (topicKey === 'career' && entry.careerEffect) return entry.careerEffect;
  if ((topicKey === 'marriage' || topicKey === 'relationship') && entry.relationshipEffect) return entry.relationshipEffect;
  if (topicKey === 'health' && entry.healthEffect) return entry.healthEffect;
  return '';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
