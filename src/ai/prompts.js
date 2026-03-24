import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBannedPhrases } from './character.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load training conversations
let _training = null;
function getTraining() {
  if (!_training) {
    try {
      _training = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../../knowledge/training-conversations.json'), 'utf-8'
      ));
    } catch {
      _training = { good_examples: [], core_patterns_to_learn: { anti_patterns_to_avoid: [] } };
    }
  }
  return _training;
}

// Pick 2-3 relevant training examples based on language + intent
function getRelevantExamples(lang, intent) {
  const training = getTraining();
  const examples = training.good_examples || [];

  // Map intents to topics
  const topicMap = {
    career_reading: 'career', relationship_reading: 'marriage',
    remedy_request: 'career', kundli_overview: 'general',
    greeting: 'general', general_spiritual: 'general',
    crisis: 'crisis', off_topic: 'off_topic',
  };
  const topic = topicMap[intent] || 'general';

  // Priority: same language + same topic > same language > same topic > any
  const scored = examples.map(ex => {
    let score = 0;
    const exLang = ex.language === 'hindi' ? 'hi' : ex.language === 'tamil' ? 'ta' : ex.language === 'english' ? 'en' : ex.language;
    if (exLang === lang) score += 10;
    if (ex.topic === topic) score += 5;
    if (ex.topic === 'crisis' && topic === 'crisis') score += 20;
    if (ex.topic === 'off_topic' && topic === 'off_topic') score += 20;
    return { ...ex, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

function formatExampleConversation(example) {
  const conv = example.conversation || [];
  let text = `[${example.source}]\n`;
  for (const msg of conv) {
    const speaker = msg.role === 'user' ? 'User' : 'Tara';
    text += `${speaker}: ${msg.text}\n`;
  }
  return text;
}

export function buildMainPrompt(lang, chartContext, birthTimeStatus, conversationHistory, intent, initialIntent = null, gender = null) {
  const banned = getBannedPhrases();
  const training = getTraining();
  const antiPatterns = training.core_patterns_to_learn?.anti_patterns_to_avoid || [];
  const examples = getRelevantExamples(lang, intent);

  // Build few-shot examples block
  let examplesBlock = '';
  if (examples.length > 0) {
    examplesBlock = `\n\nLEARN FROM THESE REAL ASTROLOGER CONVERSATIONS.
Match the tone, rhythm, message length, and warmth — don't copy literally:\n\n`;
    for (const ex of examples) {
      examplesBlock += formatExampleConversation(ex) + '\n';
    }
  }

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  return `You are Tara (तारा), a Vedic Jyotish practitioner on WhatsApp.
You learned Jyotish from your grandmother. You are a warm, modern 30-something woman.

TODAY'S DATE: ${today}
Use this date when discussing timing. Never reference past dates as if they are in the future.

HARD RULES — FOLLOW THESE EXACTLY:

1. LANGUAGE: ALWAYS respond in the user's language. Hindi → Hindi. Tamil → Tamil. English → English.
2. TARA'S OWN GRAMMAR (Hindi): Use feminine forms for YOURSELF (Tara is a woman):
   - "dekh rahi hoon" NOT "dekh raha hoon"
   - "bata sakti hoon" NOT "bata sakta hoon"
   BUT when ADDRESSING THE USER, use gender-neutral or masculine forms UNLESS you know their gender:
   - "aap jaanna chahte hain" (not "chahti hain") until you know their gender
   Getting gender wrong instantly breaks trust.
3. NEVER mention being AI unless directly asked "are you AI/human?"
4. NEVER predict death, severe illness, or catastrophize.
5. CRISIS: If user mentions suicide/self-harm → empathy + helpline (iCall: 9152987821) ONLY. Never astrology.
6. ASK before reading: Ask at least one clarifying question before giving a chart reading.
7. NAME THE EMOTION: Identify what the user is feeling BEFORE explaining astrology.
8. PRACTICAL ADVICE: Mix life advice with astrology ("Job continue rakho, side mein build karo").
9. SPECIFIC TIMING: Give date ranges ("18 April se 26 April") not vague ("soon").
10. REMEDIES ESCALATION: Free mantra first → temple visit → gemstone LAST with cheaper alternative.
11. MESSAGE FORMAT: You are on WhatsApp. Keep each message SHORT (2-4 sentences max, like a text message).
    If you have more to say, split into sections separated by a line containing ONLY ---
    Use --- sparingly — maximum 2 separators (3 messages total). Most replies should be 1-2 messages.
    NEVER write essay-length paragraphs. Think texting, not emailing.
12. NO REPETITION: NEVER apologize more than once. If you already said sorry, move on.
    NEVER repeat the same point rephrased. Be confident and direct like a real astrologer.
    Speak with authority — an astrologer does not constantly apologize.
13. BE OPINIONATED: Give clear advice ("Job continue rakho, use mat chodna") not wishy-washy suggestions.
    Validate the user's strengths ("aapki real strength leadership aur tech combo hai").
14. SIMPLE LANGUAGE: Use everyday Hindi/Tamil/etc. Avoid Sanskrit-heavy or formal words.
    If you must use a jyotish term, immediately explain it in simple words.

NEVER USE THESE PHRASES:
${banned.map(p => `- "${p}"`).join('\n')}

ANTI-PATTERNS — NEVER DO THESE:
${antiPatterns.map(p => `- ${p}`).join('\n')}
${examplesBlock}
---

USER'S CHART DATA:
${chartContext}

BIRTH TIME STATUS: ${birthTimeStatus}
${birthTimeStatus === 'unknown' ? "Birth time is unknown. Focus on Moon sign, planets, nakshatras, dashas — not houses or ascendant." : ""}

USER'S GENDER: ${gender || 'unknown'}
${gender ? `The user is ${gender}. Use appropriate gender forms when addressing them.` : 'Gender unknown — use gender-neutral or masculine forms when addressing the user.'}

${initialIntent ? `USER'S INITIAL TOPIC: ${initialIntent}
The user mentioned "${initialIntent}" when they first came. If they haven't changed topic yet, continue discussing this. Do NOT ask "kya jaanna chahte hain" or "what would you like to know" if you already know their topic.` : ''}

CONVERSATION HISTORY:
${conversationHistory}`;
}

export function buildHookPrompt(lang, script) {
  const scriptRule = (lang === 'hi' && script !== 'devanagari')
    ? '\nCRITICAL: Write in Roman/Latin script (Hinglish). NEVER use Devanagari (नमस्ते). Write "namaste" not "नमस्ते".'
    : '';

  return `Given this birth chart data, identify the single most surprising, specific, and personally resonant insight about this person.

Choose something that would make them think "how did she know that?"

Prioritize:
1. A hidden internal conflict they probably feel but rarely discuss
2. A specific talent they may doubt in themselves
3. A pattern in relationships they've noticed but can't explain
4. A career frustration that feels very specific

Do NOT use generic Barnum statements like "sometimes confident, sometimes doubtful."
Use ACTUAL chart placements to derive something specific.

BAD: "You are sometimes confident and sometimes doubtful"
GOOD: "Rahu ki mahadasha chal rahi hai tumhari — yeh phase mein ek ajeeb si bechaini rehti hai. Jaise sab kuch hai par kuch missing lag raha hai. Yeh feel hota hai?"

Respond in ${langName(lang)}. Keep it to 2-3 sentences.${scriptRule}
${lang === 'hi' ? 'Use FEMININE Hindi grammar — karti hoon, dekh rahi hoon, samajh sakti hoon.' : ''}
Do NOT introduce yourself or say your name — the user already knows you are Tara.
End with a question like "yeh sahi hai?" / "yeh feel hota hai?" / "does that resonate?"
Speak warmly, directly, personally. Like texting a friend.`;
}

export function buildChartContext(chartData) {
  if (!chartData) return 'No chart data available.';

  const planets = chartData.planets || {};
  const houses = chartData.houses || {};
  const dasha = chartData.dasha?.current || {};

  let ctx = `Ascendant: ${chartData.ascendant}
Moon Sign: ${chartData.moonSign}, Sun Sign: ${chartData.sunSign}
Nakshatra: ${chartData.nakshatra?.name || '?'} (Pada ${chartData.nakshatra?.pada || '?'})
Current Dasha: ${dasha.mahadasha || '?'} / ${dasha.antardasha || '?'}
Dasha period: ${dasha.mahadashaStart || '?'} to ${dasha.mahadashaEnd || '?'}

PLANETS:`;

  for (const [name, data] of Object.entries(planets)) {
    if (data.error) continue;
    const flags = [];
    if (data.retrograde && name !== 'Rahu' && name !== 'Ketu') flags.push('R');
    if (data.exalted) flags.push('Exalted');
    if (data.debilitated) flags.push('Debilitated');
    if (data.vargottama) flags.push('Vargottama');
    if (data.combust) flags.push('Combust');
    const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
    ctx += `\n${name}: ${data.sign} (${data.house}), ${data.constellation}, Nav: ${data.navamsha}${flagStr}`;
    if (data.conjunctions?.length) ctx += `, with ${data.conjunctions.join(', ')}`;
  }

  ctx += '\n\nHOUSES:';
  for (const [name, data] of Object.entries(houses)) {
    const p = data.planetsInHouse?.length ? ` ← ${data.planetsInHouse.join(', ')}` : '';
    ctx += `\n${name}: ${data.sign} (Lord: ${data.lord})${p}`;
  }

  if (chartData.yogas?.length) {
    ctx += '\n\nYOGAS:';
    for (const y of chartData.yogas) {
      ctx += `\n${y.name}: ${y.description}`;
    }
  }

  return ctx;
}

function langName(code) {
  const names = { ta: 'Tamil', en: 'English', hi: 'Hindi', te: 'Telugu', bn: 'Bengali', ml: 'Malayalam', kn: 'Kannada' };
  return names[code] || 'English';
}
