/**
 * LLM-powered parser fallback — when regex fails, ask Gemini Flash.
 *
 * Cost: ~50 input + ~30 output tokens per call (~$0.0001)
 * Latency: ~500ms (Flash is fast)
 *
 * Handles: "poune 11 baje raat ko", "Date of birth 5.7.1990",
 * "around 10:20am", "Nissar hu 10 June 1990 Jagdalpur mein"
 */
import { getProvider } from '../ai/geminiProvider.js';
import { logger } from '../utils/logger.js';

const PARSE_PROMPT = `Extract birth data from this message. Return ONLY valid JSON, nothing else.

Rules:
- date: YYYY-MM-DD format. Parse any date format (DD/MM/YYYY, "10 June 1990", "5.7.1990" = 5 July 1990)
- time: HH:MM in 24h format. Parse Hindi ("poune 11 baje raat" = 22:45, "sawa 3 baje subah" = 03:15, "around 10:20am" = 10:20)
- time_known: false if user said "pata nahi", "don't know", "not sure", or no time given
- name: person's name only, NOT "Date of birth" or other prefixes
- place: city/town name only, strip "mein", "me", "ka", "district" etc.
- Null for any field not found in the message
- If message is just a greeting or acknowledgment, return all nulls

{"name":string|null, "date":string|null, "time":string|null, "time_known":boolean, "place":string|null}`;

/**
 * Parse birth data using LLM when regex fails.
 * @param {string} messageText - User's raw message
 * @param {string} currentStep - Which onboarding step we're on (helps context)
 * @returns {Object} { name, date, time: { time, known }, place } or nulls
 */
export async function llmParseBirthData(messageText, currentStep = '') {
  try {
    const provider = getProvider();

    const contextHint = currentStep
      ? `\nContext: We are currently asking for "${currentStep.replace('awaiting_', '')}".`
      : '';

    const result = await provider.classify(
      messageText + contextHint,
      PARSE_PROMPT
    );

    if (!result) {
      logger.warn({ messageText }, '[LLM_PARSER] No result from LLM');
      return { name: null, date: null, time: null, place: null };
    }

    logger.info({ input: messageText, parsed: result }, '[LLM_PARSER] Parsed');

    // Normalize the result to match our internal format
    const parsed = {
      name: result.name || null,
      date: result.date || null,
      time: null,
      place: result.place || null,
    };

    // Convert time to our internal format
    if (result.time) {
      const timeParts = result.time.match(/^(\d{1,2}):(\d{2})$/);
      if (timeParts) {
        const hours = String(timeParts[1]).padStart(2, '0');
        const mins = String(timeParts[2]).padStart(2, '0');
        parsed.time = {
          time: `${hours}:${mins}:00`,
          known: result.time_known !== false,
        };
      }
    } else if (result.time_known === false) {
      // User explicitly said they don't know
      parsed.time = { time: '12:00:00', known: false };
    }

    // Validate date format
    if (parsed.date) {
      const dateMatch = parsed.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        logger.warn({ date: parsed.date }, '[LLM_PARSER] Invalid date format from LLM');
        parsed.date = null;
      } else {
        const year = parseInt(dateMatch[1]);
        if (year < 1920 || year > 2015) {
          logger.warn({ year }, '[LLM_PARSER] Year out of range');
          parsed.date = null;
        }
      }
    }

    return parsed;
  } catch (err) {
    logger.error({ err: err.message }, '[LLM_PARSER] Failed');
    return { name: null, date: null, time: null, place: null };
  }
}
