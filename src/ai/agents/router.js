/**
 * Router Agent — fast, cheap intent classification + user tier gating.
 * Uses Gemini Flash for classification (~50 output tokens).
 * Returns which specialized agent to route to + token budget.
 */
import { getProvider } from '../geminiProvider.js';
import { logger } from '../../utils/logger.js';

// Agent types that the router can dispatch to
export const AGENTS = {
  GREETING: 'greeting',       // Hi/bye, chitchat — flash, tiny prompt
  READING: 'reading',         // Deep chart analysis — pro, full chart context
  FOLLOWUP: 'followup',       // "okay", "achha", short acknowledgments — flash, minimal
  REMEDY: 'remedy',           // Specific remedy request — flash, prescriptive
  CLARIFY: 'clarify',         // Need more info from user — flash, short
  CRISIS: 'crisis',           // Self-harm/suicide — NO LLM, hardcoded response
  GATE: 'gate',               // Free tier exceeded — redirect to payment
  OFF_TOPIC: 'off_topic',     // Non-astrology — flash, gentle redirect
};

// Token budgets per agent (maxOutputTokens)
export const TOKEN_BUDGETS = {
  [AGENTS.GREETING]: 200,
  [AGENTS.READING]: 1500,     // Was 800 — truncating readings mid-sentence
  [AGENTS.FOLLOWUP]: 150,
  [AGENTS.REMEDY]: 600,       // Was 400 — need room for specific remedies
  [AGENTS.CLARIFY]: 200,
  [AGENTS.CRISIS]: 0,         // No LLM
  [AGENTS.GATE]: 0,           // No LLM
  [AGENTS.OFF_TOPIC]: 200,
};

// Model per agent
export const AGENT_MODELS = {
  [AGENTS.GREETING]: 'flash',
  [AGENTS.READING]: 'pro',
  [AGENTS.FOLLOWUP]: 'flash',
  [AGENTS.REMEDY]: 'flash',
  [AGENTS.CLARIFY]: 'flash',
  [AGENTS.OFF_TOPIC]: 'flash',
};

const ROUTER_PROMPT = `You are a message router for a Vedic astrology WhatsApp bot.
Classify the user's message into ONE agent type and detect language.

AGENTS:
- greeting: hi, hello, namaste, how are you, casual chat, farewell, bye, dhanyawaad, thank you
- reading: career questions, relationship analysis, health concerns, future predictions, marriage timing, children, finances — anything needing chart analysis
- followup: short acknowledgments like "ok", "achha", "hmm", "samjha", "theek hai", "got it" — these need a brief warm response, NOT a new reading
- remedy: asking for specific remedies, mantras, gemstones, temple visits, upaay
- clarify: user's message is ambiguous or you need more info to give a reading
- crisis: ONLY explicit suicide/self-harm ("marna chahta", "kill myself", "jaan de doon")
- off_topic: completely unrelated to astrology or life guidance

CRITICAL RULES:
- "ok" / "achha" / "theek hai" after a reading = followup (NOT reading)
- Questions about career, marriage, children, health = reading (even short ones)
- "kya upaay hai" / "remedy batao" = remedy
- Frustrated messages ("kitna time", "jaldi karo") = followup

Return ONLY JSON:
{"agent":"<agent_type>","language":"<hi|ta|en|te|bn|ml|kn>","topic":"<1-3 word topic>","needs_chart":true/false}`;

export async function routeMessage(messageText, conversationHistory = []) {
  try {
    const provider = getProvider();

    // Include last 2 messages for context (helps distinguish followup from new topic)
    let contextHint = '';
    if (conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-2);
      contextHint = '\n\nRecent context:\n' + recent.map(m =>
        `${m.role === 'user' ? 'User' : 'Tara'}: ${m.content.substring(0, 100)}`
      ).join('\n');
    }

    const result = await provider.classify(
      messageText + contextHint,
      ROUTER_PROMPT
    );

    if (result && result.agent && Object.values(AGENTS).includes(result.agent)) {
      return {
        agent: result.agent,
        language: result.language || 'en',
        topic: result.topic || '',
        needsChart: result.needs_chart !== false,
        tokenBudget: TOKEN_BUDGETS[result.agent] || 300,
        model: AGENT_MODELS[result.agent] || 'flash',
      };
    }

    logger.warn({ result }, 'Router returned invalid agent, defaulting to reading');
    return {
      agent: AGENTS.READING,
      language: 'en',
      topic: '',
      needsChart: true,
      tokenBudget: TOKEN_BUDGETS[AGENTS.READING],
      model: 'pro',
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Router failed, defaulting to reading');
    return {
      agent: AGENTS.READING,
      language: 'en',
      topic: '',
      needsChart: true,
      tokenBudget: TOKEN_BUDGETS[AGENTS.READING],
      model: 'pro',
    };
  }
}
