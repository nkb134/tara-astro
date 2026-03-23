import { getProvider } from './geminiProvider.js';
import { logger } from '../utils/logger.js';

const CLASSIFICATION_PROMPT = `You are an intent classifier for a Vedic astrology WhatsApp conversation.
Given the user's message (which may be in Tamil, English, Hindi, Telugu, Bengali, or a mix), classify it.

Respond with ONLY a JSON object, no other text:
{
  "intent": one of ["greeting", "kundli_overview", "career_reading", "relationship_reading", "remedy_request", "transit_question", "chart_explanation", "general_spiritual", "update_birth_data", "off_topic", "crisis", "farewell"],
  "complexity": one of ["simple", "complex"],
  "language": detected language code ("ta", "en", "hi", "te", "bn", "ml", "kn"),
  "planets_relevant": [],
  "houses_relevant": []
}

Rules:
- "greeting" = hi, hello, namaste, vanakkam, etc.
- "crisis" = ONLY for explicit mentions of suicide, self-harm, wanting to die, or ending life. Regular stress, anxiety, sadness, frustration about career/relationships is NOT crisis — classify those as career_reading or relationship_reading instead.
- "off_topic" = topics unrelated to astrology, spirituality, or life guidance
- "complex" = detailed readings, career analysis, relationship deep-dive, remedy requests
- "simple" = greetings, quick questions, clarifications, farewells`;

const FALLBACK_RESULT = {
  intent: 'kundli_overview',
  complexity: 'simple',
  language: 'en',
  planets_relevant: [],
  houses_relevant: [],
};

export async function classifyIntent(message, userLang = 'en') {
  try {
    const provider = getProvider();
    const result = await provider.classify(message, CLASSIFICATION_PROMPT);

    if (result && result.intent) {
      return {
        intent: result.intent,
        complexity: result.complexity || 'simple',
        language: result.language || userLang,
        planets_relevant: result.planets_relevant || [],
        houses_relevant: result.houses_relevant || [],
      };
    }

    logger.warn('Classifier returned invalid result, using fallback');
    return { ...FALLBACK_RESULT, language: userLang };
  } catch (err) {
    logger.error({ err: err.message }, 'Intent classification failed');
    return { ...FALLBACK_RESULT, language: userLang };
  }
}
