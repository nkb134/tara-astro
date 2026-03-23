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
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';

  // Tanglish / Hinglish detection via common words
  const lower = text.toLowerCase();
  const tamilWords = ['vanakkam', 'enna', 'naan', 'pathi', 'sollunga', 'theriyum',
    'venum', 'eppadi', 'romba', 'thala', 'paaru', 'kovil', 'jathagam', 'rasi',
    'en', 'ungal', 'peru', 'enga', 'inga', 'anga', 'panna', 'solla', 'kelu'];
  const hindiWords = ['mera', 'mujhe', 'kya', 'hai', 'hain', 'kaise', 'batao',
    'kundli', 'shaadi', 'naukri', 'paisa', 'naam', 'bolo', 'chahiye'];

  const tamilScore = tamilWords.filter(w => lower.includes(w)).length;
  const hindiScore = hindiWords.filter(w => lower.includes(w)).length;

  if (tamilScore >= 2) return 'ta';
  if (hindiScore >= 2) return 'hi';
  if (tamilScore === 1) return 'ta';
  if (hindiScore === 1) return 'hi';

  return 'en';
}
