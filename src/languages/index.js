import ta from './ta.js';
import en from './en.js';
import hi from './hi.js';
import te from './te.js';
import bn from './bn.js';
import ml from './ml.js';
import kn from './kn.js';

const languages = { ta, en, hi, te, bn, ml, kn };

export function t(lang, key) {
  const strings = languages[lang] || languages.en;
  return strings[key] || languages.en[key] || key;
}

// Check if text is language-neutral (just names, dates, numbers, places)
export function isLanguageNeutral(text) {
  const cleaned = text.trim()
    .replace(/\d{1,2}[\/\-.:]\d{1,2}[\/\-.:]\d{2,4}/g, '') // dates
    .replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, '') // times
    .replace(/\d+/g, '') // numbers
    .replace(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi, '') // months
    .replace(/(am|pm)/gi, '')
    .replace(/[,.\-\/]/g, '')
    .trim();

  // If very little text remains after stripping, it's neutral
  if (cleaned.length < 3) return true;

  // Single word that could be a name or place
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  if (words.length <= 1) return true;

  return false;
}

// Detect script (Latin vs native) — stored separately from language
export function detectScript(text) {
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
  if (/[\u0980-\u09FF]/.test(text)) return 'bengali';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'malayalam';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kannada';
  return 'latin';
}

export function detectLanguage(text, storedLang = null) {
  // Script-based detection — but DON'T override stored language
  // If user was chatting in Hinglish (Latin), don't switch to Devanagari Hindi
  const script = detectScript(text);

  if (script !== 'latin') {
    // Native script detected — if stored language already matches the language family, keep it
    // This prevents "Hinglish user accidentally types in Devanagari" from switching everything
    if (storedLang === 'hi' && script === 'devanagari') return 'hi';
    if (storedLang === 'ta' && script === 'tamil') return 'ta';
    if (storedLang === 'te' && script === 'telugu') return 'te';
    if (storedLang === 'bn' && script === 'bengali') return 'bn';
    if (storedLang === 'ml' && script === 'malayalam') return 'ml';
    if (storedLang === 'kn' && script === 'kannada') return 'kn';

    // No stored language yet — use script detection
    if (script === 'devanagari') return 'hi';
    if (script === 'tamil') return 'ta';
    if (script === 'telugu') return 'te';
    if (script === 'bengali') return 'bn';
    if (script === 'malayalam') return 'ml';
    if (script === 'kannada') return 'kn';
  }

  // Romanized word detection
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  const hindiWords = ['namaste', 'namaskar', 'pranam', 'pranaam',
    'mera', 'meri', 'mujhe', 'mujhse', 'kya', 'hai', 'hain',
    'kaise', 'batao', 'bataiye', 'bataao', 'kundli', 'shaadi', 'shaadhi',
    'naukri', 'paisa', 'naam', 'bolo', 'chahiye', 'chahie', 'karun', 'karungi',
    'kab', 'kahan', 'kaisa', 'achha', 'acha', 'hogi', 'hoga', 'karein',
    'madad', 'zaroor', 'zarur', 'pata', 'nahi', 'nahin', 'koi', 'baat',
    'janam', 'tithi', 'samay', 'pehle', 'abhi', 'aur', 'aapka', 'aapki',
    'mein', 'se', 'pe', 'ke', 'ki', 'ka', 'ko', 'hoon', 'hun',
    'dekho', 'suno', 'bhai', 'didi', 'ji', 'bol', 'sun', 'dasha',
    'graha', 'rashi', 'lagna', 'mangal', 'shani', 'shukra', 'guru',
    'ghar', 'parivaar', 'bachcha', 'beta', 'beti', 'pati', 'patni',
    'madamji', 'sahab', 'sahib', 'sirji', 'maaji', 'panditji', 'guruji',
    'accha', 'theek', 'thik', 'bilkul', 'zaroor', 'bohot', 'bahut',
    'chahiye', 'chahte', 'boliye', 'dijiye', 'kijiye', 'rha', 'rhe', 'rhi'];

  const tamilWords = ['vanakkam', 'enna', 'naan', 'pathi', 'sollunga', 'theriyum',
    'venum', 'eppadi', 'romba', 'paaru', 'kovil', 'jathagam', 'rasi',
    'ungal', 'peru', 'enga', 'inga', 'anga', 'panna', 'solla', 'kelu',
    'seri', 'paarkiren', 'theriyaadhu', 'theriyala', 'illa', 'irukku',
    'vaanga', 'ponga', 'pannunga', 'sollu', 'oru', 'enaku', 'unaku',
    'eppo', 'eppadi', 'yenna', 'yaar', 'entha', 'ooru', 'velai',
    'kalyanam', 'thirumanam', 'parigaram', 'natchathiram', 'lagnam',
    'pirandha', 'theadhi', 'neram', 'nalla', 'ketta'];

  const teluguWords = ['namaskaram', 'nenu', 'naaku', 'meeru', 'mee', 'emi', 'cheppandi',
    'telusu', 'kavali', 'chustanu', 'puttina', 'tariku', 'samayam',
    'ekkada', 'pelli', 'udyogam', 'jatakam', 'raashi', 'chudandi',
    'sare', 'manchi', 'chala', 'oka', 'ante', 'inka', 'leda'];

  const bengaliWords = ['ami', 'amar', 'apnar', 'apni', 'bolun', 'chai',
    'jonmo', 'tarik', 'somoy', 'kothay', 'biye', 'chakri', 'kundli',
    'dekhi', 'dekhchi', 'jaanen', 'jani', 'bhalo', 'kemon', 'hobe'];

  const hindiScore = words.filter(w => hindiWords.includes(w)).length;
  const tamilScore = words.filter(w => tamilWords.includes(w)).length;
  const teluguScore = words.filter(w => teluguWords.includes(w)).length;
  const bengaliScore = words.filter(w => bengaliWords.includes(w)).length;

  const scores = { hi: hindiScore, ta: tamilScore, te: teluguScore, bn: bengaliScore };
  const maxLang = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  if (maxLang[1] >= 2) return maxLang[0];
  if (maxLang[1] === 1) return maxLang[0];

  return 'en';
}
