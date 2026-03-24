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
  DEFLECT: 'deflect',         // "aap bot ho?", "AI hai kya", meta-questions about Tara — flash, witty
  CRISIS: 'crisis',           // Self-harm/suicide — NO LLM, hardcoded response
  GATE: 'gate',               // Free tier exceeded — redirect to payment
  OFF_TOPIC: 'off_topic',     // Non-astrology — flash, gentle redirect
};

// Token budgets per agent (maxOutputTokens)
export const TOKEN_BUDGETS = {
  [AGENTS.GREETING]: 200,
  [AGENTS.READING]: 1500,
  [AGENTS.FOLLOWUP]: 150,
  [AGENTS.REMEDY]: 600,
  [AGENTS.CLARIFY]: 200,
  [AGENTS.DEFLECT]: 200,      // Witty bot-denial
  [AGENTS.CRISIS]: 0,
  [AGENTS.GATE]: 0,
  [AGENTS.OFF_TOPIC]: 200,
};

// Model per agent
export const AGENT_MODELS = {
  [AGENTS.GREETING]: 'flash',
  [AGENTS.READING]: 'pro',
  [AGENTS.FOLLOWUP]: 'flash',
  [AGENTS.REMEDY]: 'flash',
  [AGENTS.CLARIFY]: 'flash',
  [AGENTS.DEFLECT]: 'flash',
  [AGENTS.OFF_TOPIC]: 'flash',
};

const ROUTER_PROMPT = `You are a message router for a Vedic astrology WhatsApp bot.
Classify the user's message into ONE agent type and detect language.

AGENTS:
- greeting: hi, hello, namaste, how are you, casual chat, farewell, bye, dhanyawaad, thank you
- reading: career questions, relationship analysis, health concerns, future predictions, marriage timing, children, finances — anything needing chart analysis
- followup: short acknowledgments like "ok", "achha", "hmm", "hain", "haan", "ha", "samjha", "samjhi", "theek hai", "got it", "right", "sahi" — these need a brief warm response, NOT a new reading
- remedy: asking for specific remedies, mantras, gemstones, temple visits, upaay
- clarify: user's message is ambiguous or you need more info to give a reading
- deflect: user questioning if Tara is a bot/AI, asking about master prompt, asking how she types so fast, meta-questions about Tara herself
- crisis: ONLY explicit suicide/self-harm ("marna chahta", "kill myself", "jaan de doon")
- off_topic: completely unrelated to astrology or life guidance (politics, cricket, weather, tech support)

CRITICAL RULES:
- "ok" / "achha" / "theek hai" / "hain" / "haan" / "ha" / "hmm" / "sahi" after a reading = followup (NOT reading)
- Single Hindi words like "hain", "haan", "nahi" = followup (NEVER reading)
- Questions about career, marriage, children, health = reading (even short ones)
- "kya upaay hai" / "remedy batao" = remedy
- Frustrated messages ("kitna time", "jaldi karo") = followup
- "bot ho kya", "AI hai", "itna fast kaise", "typing nahi dikhta" = deflect (NOT off_topic)
- User complaining about Tara's responses = followup (NOT off_topic)
- NEVER classify a message as off_topic if the user is talking about their life/relationships/problems

Return ONLY JSON:
{"agent":"<agent_type>","language":"<hi|ta|en|te|bn|ml|kn>","topic":"<1-3 word topic>","needs_chart":true/false}`;

export async function routeMessage(messageText, conversationHistory = []) {
  try {
    const provider = getProvider();

    // Include last 6 messages for context (prevents topic drift + helps followup detection)
    let contextHint = '';
    if (conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-6);
      contextHint = '\n\nConversation context (last few messages):\n' + recent.map(m =>
        `${m.role === 'user' ? 'User' : 'Tara'}: ${m.content.substring(0, 150)}`
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
