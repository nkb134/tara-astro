import { t } from '../languages/index.js';

const SIGN_TRANSLATIONS = {
  ta: {
    Aries: 'மேஷம்', Taurus: 'ரிஷபம்', Gemini: 'மிதுனம்', Cancer: 'கடகம்',
    Leo: 'சிம்மம்', Virgo: 'கன்னி', Libra: 'துலாம்', Scorpio: 'விருச்சிகம்',
    Sagittarius: 'தனுசு', Capricorn: 'மகரம்', Aquarius: 'கும்பம்', Pisces: 'மீனம்',
  },
  hi: {
    Aries: 'मेष', Taurus: 'वृषभ', Gemini: 'मिथुन', Cancer: 'कर्क',
    Leo: 'सिंह', Virgo: 'कन्या', Libra: 'तुला', Scorpio: 'वृश्चिक',
    Sagittarius: 'धनु', Capricorn: 'मकर', Aquarius: 'कुम्भ', Pisces: 'मीन',
  },
  te: {
    Aries: 'మేషం', Taurus: 'వృషభం', Gemini: 'మిథునం', Cancer: 'కర్కాటకం',
    Leo: 'సింహం', Virgo: 'కన్య', Libra: 'తుల', Scorpio: 'వృశ్చికం',
    Sagittarius: 'ధనుస్సు', Capricorn: 'మకరం', Aquarius: 'కుంభం', Pisces: 'మీనం',
  },
};

function translateSign(sign, lang) {
  return SIGN_TRANSLATIONS[lang]?.[sign] || sign;
}

export function formatChartOverview(chartData, lang, userName) {
  const name = userName || 'friend';
  const sunSign = translateSign(chartData.sunSign, lang);
  const moonSign = translateSign(chartData.moonSign, lang);
  const ascendant = translateSign(chartData.ascendant, lang);
  const nakshatra = chartData.nakshatra?.name || 'Unknown';
  const pada = chartData.nakshatra?.pada || '';

  // Find notable features
  const notable = findNotableFeature(chartData, lang);

  const template = t(lang, 'chart_overview');
  return template
    .replace('{name}', name)
    .replace('{sunSign}', sunSign)
    .replace('{moonSign}', moonSign)
    .replace('{ascendant}', ascendant)
    .replace('{nakshatra}', nakshatra + (pada ? ` (Pada ${pada})` : ''))
    .replace('{notable}', notable);
}

function findNotableFeature(chartData, lang) {
  const planets = chartData.planets || {};
  const features = [];

  // Check for exalted planets
  for (const [name, data] of Object.entries(planets)) {
    if (data.exalted) {
      features.push({ type: 'exalted', planet: name, sign: data.sign });
    }
  }

  // Check for vargottama planets
  for (const [name, data] of Object.entries(planets)) {
    if (data.vargottama) {
      features.push({ type: 'vargottama', planet: name });
    }
  }

  // Check strong planets
  for (const [name, data] of Object.entries(planets)) {
    if (data.powerPercentage > 80 && name !== 'Rahu' && name !== 'Ketu') {
      features.push({ type: 'strong', planet: name, power: Math.round(data.powerPercentage) });
    }
  }

  if (features.length === 0) {
    return t(lang, 'notable_default');
  }

  const f = features[0];
  if (f.type === 'exalted') {
    return t(lang, 'notable_exalted').replace('{planet}', f.planet).replace('{sign}', translateSign(f.sign, lang));
  }
  if (f.type === 'vargottama') {
    return t(lang, 'notable_vargottama').replace('{planet}', f.planet);
  }
  if (f.type === 'strong') {
    return t(lang, 'notable_strong').replace('{planet}', f.planet).replace('{power}', f.power);
  }

  return t(lang, 'notable_default');
}
