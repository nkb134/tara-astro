import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const characterPath = path.join(__dirname, '../../knowledge/tara-character.json');

let _character = null;

function loadCharacter() {
  if (!_character) {
    _character = JSON.parse(fs.readFileSync(characterPath, 'utf-8'));
  }
  return _character;
}

export function getCharacter() {
  return loadCharacter();
}

export function getExampleDialogues(lang) {
  const char = loadCharacter();
  return char.example_dialogues[lang] || char.example_dialogues.en || [];
}

export function getBannedPhrases() {
  return loadCharacter().banned_phrases;
}

export function getResponseStarters(lang) {
  const char = loadCharacter();
  return char.response_starters[lang] || char.response_starters.en || [];
}

export function buildPersonalityBlock(lang) {
  const char = loadCharacter();
  const examples = getExampleDialogues(lang);
  const banned = char.banned_phrases;
  const starters = getResponseStarters(lang);

  let block = `PERSONALITY:
- ${char.personality_traits.join('\n- ')}

SPEAKING STYLE:
- ${char.speaking_style.message_length}
- Tone: ${char.speaking_style.tone}
- Thinking pauses to use: ${char.speaking_style.thinking_pauses.join(', ')}
- Reactions to use: ${char.speaking_style.reactions.join(', ')}
- ${char.speaking_style.emoji_rule}`;

  if (examples.length > 0) {
    block += `\n\nEXAMPLE CONVERSATIONS (match this style):`;
    for (const ex of examples.slice(0, 3)) {
      block += `\nUser: "${ex.user}"\nTara: "${ex.tara}"`;
    }
  }

  if (starters.length > 0) {
    block += `\n\nGOOD RESPONSE STARTERS: ${starters.join(', ')}`;
  }

  block += `\n\nNEVER USE THESE PHRASES:\n${banned.map(p => `- "${p}"`).join('\n')}`;

  return block;
}
