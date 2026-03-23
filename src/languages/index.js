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

export function detectLanguage(text) {
  // Script-based detection (most reliable)
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';

  // Romanized word detection
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  const hindiWords = ['mera', 'meri', 'mujhe', 'mujhse', 'kya', 'hai', 'hain',
    'kaise', 'batao', 'bataiye', 'bataao', 'kundli', 'shaadi', 'shaadhi',
    'naukri', 'paisa', 'naam', 'bolo', 'chahiye', 'chahie', 'karun', 'karungi',
    'kab', 'kahan', 'kaisa', 'achha', 'acha', 'hogi', 'hoga', 'karein',
    'madad', 'zaroor', 'zarur', 'pata', 'nahi', 'nahin', 'koi', 'baat',
    'janam', 'tithi', 'samay', 'pehle', 'abhi', 'aur', 'aapka', 'aapki',
    'mein', 'se', 'pe', 'ke', 'ki', 'ka', 'ko', 'hoon', 'hun',
    'dekho', 'suno', 'bhai', 'didi', 'ji', 'bol', 'sun', 'dasha',
    'graha', 'rashi', 'lagna', 'mangal', 'shani', 'shukra', 'guru',
    'ghar', 'parivaar', 'bachcha', 'beta', 'beti', 'pati', 'patni'];

  const tamilWords = ['vanakkam', 'enna', 'naan', 'pathi', 'sollunga', 'theriyum',
    'venum', 'eppadi', 'romba', 'paaru', 'kovil', 'jathagam', 'rasi',
    'ungal', 'peru', 'enga', 'inga', 'anga', 'panna', 'solla', 'kelu',
    'seri', 'paarkiren', 'theriyaadhu', 'theriyala', 'illa', 'irukku',
    'vaanga', 'ponga', 'pannunga', 'sollu', 'oru', 'enaku', 'unaku',
    'eppo', 'eppadi', 'yenna', 'yaar', 'entha', 'ooru', 'velai',
    'kalyanam', 'thirumanam', 'parigaram', 'natchathiram', 'lagnam',
    'pirandha', 'theadhi', 'neram', 'nalla', 'ketta'];

  const teluguWords = ['nenu', 'naaku', 'meeru', 'mee', 'emi', 'cheppandi',
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
