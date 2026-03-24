/**
 * Agent Dispatcher — orchestrates the multi-agent flow.
 *
 * Flow: routeMessage() → select agent → build focused prompt → generate → return
 *
 * Token savings vs monolithic approach:
 * - Greeting: ~200 system tokens (vs ~2000 monolithic) = 90% saving
 * - Followup: ~150 system tokens = 92% saving
 * - Reading: ~1200 system tokens (chart included) = 40% saving
 * - Off-topic: ~200 system tokens = 90% saving
 */
import { routeMessage, AGENTS, TOKEN_BUDGETS, AGENT_MODELS } from './router.js';
import {
  greetingPrompt, readingPrompt, followupPrompt,
  remedyPrompt, clarifyPrompt, offTopicPrompt,
  CRISIS_RESPONSES, gateResponse,
} from './prompts.js';
import { getProvider } from '../geminiProvider.js';
import { checkUserTier } from '../../services/tierManager.js';
import { trackTokenUsage } from '../../services/tokenTracker.js';
import { logger } from '../../utils/logger.js';

/**
 * Main entry point — replaces the old classifyIntent + generateResponse flow.
 * Returns { text, model, agent, tokenBudget, responseTimeMs, language, intent }
 */
export async function dispatchToAgent(userMessage, user, conversationHistory = []) {
  const startTime = Date.now();
  const lang = user.language || 'en';
  const chartData = typeof user.chart_data === 'string' ? JSON.parse(user.chart_data) : user.chart_data;
  const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
  const initialIntent = prefs.initial_intent || null;
  const gender = user.gender || null;
  const birthTimeStatus = user.birth_time_known === false ? 'unknown' : 'known';

  // Step 1: Route (fast classification — ~50 tokens output)
  const route = await routeMessage(userMessage, conversationHistory);
  logger.info({ agent: route.agent, topic: route.topic, lang: route.language }, 'Routed to agent');

  // Step 2: Check user tier (free/paid/expired)
  const tier = await checkUserTier(user);
  if (tier.blocked) {
    return {
      text: gateResponse(lang, tier.reason),
      model: 'none',
      agent: AGENTS.GATE,
      tokenBudget: 0,
      responseTimeMs: Date.now() - startTime,
      language: lang,
      intent: 'gate',
    };
  }

  // Step 3: Crisis — no LLM needed
  if (route.agent === AGENTS.CRISIS) {
    // Double-check with keyword guard
    const crisisKeywords = /\b(suicide|suicid|marr?na|khatam kar|end.?life|jeena nahi|marna chahta|aatmahatya|die|kill myself|kill me|zindagi khatam|jaan de|khudkhushi)\b/i;
    if (!crisisKeywords.test(userMessage)) {
      // Downgrade to reading
      route.agent = AGENTS.READING;
      route.model = 'pro';
      route.tokenBudget = TOKEN_BUDGETS[AGENTS.READING];
    } else {
      return {
        text: CRISIS_RESPONSES[lang] || CRISIS_RESPONSES.en,
        model: 'none',
        agent: AGENTS.CRISIS,
        tokenBudget: 0,
        responseTimeMs: Date.now() - startTime,
        language: lang,
        intent: 'crisis',
      };
    }
  }

  // Step 4: Build agent-specific prompt
  let systemPrompt;
  switch (route.agent) {
    case AGENTS.GREETING:
      systemPrompt = greetingPrompt(lang, gender, initialIntent);
      break;
    case AGENTS.READING:
      systemPrompt = readingPrompt(lang, gender, chartData, birthTimeStatus, route.topic, initialIntent);
      break;
    case AGENTS.FOLLOWUP:
      systemPrompt = followupPrompt(lang, gender);
      break;
    case AGENTS.REMEDY:
      systemPrompt = remedyPrompt(lang, gender, chartData);
      break;
    case AGENTS.CLARIFY:
      systemPrompt = clarifyPrompt(lang, gender, route.topic);
      break;
    case AGENTS.OFF_TOPIC:
      systemPrompt = offTopicPrompt(lang, gender);
      break;
    default:
      systemPrompt = readingPrompt(lang, gender, chartData, birthTimeStatus, route.topic, initialIntent);
      route.model = 'pro';
      route.tokenBudget = TOKEN_BUDGETS[AGENTS.READING];
  }

  // Step 5: Generate with the right model + token budget
  const provider = getProvider();

  // For free tier, cap token budget further
  const tokenBudget = tier.tier === 'free'
    ? Math.min(route.tokenBudget, 400)
    : route.tokenBudget;

  try {
    const result = await provider.generate(systemPrompt, userMessage, {
      complexity: route.model === 'pro' ? 'complex' : 'simple',
      history: conversationHistory.map(m => ({ role: m.role, content: m.content })),
      temperature: route.agent === AGENTS.READING ? 0.8 : 0.7,
      maxTokens: tokenBudget,
    });

    // Track token usage for billing
    await trackTokenUsage(user.id, {
      agent: route.agent,
      model: result.model,
      inputTokens: estimateInputTokens(systemPrompt, userMessage, conversationHistory),
      outputTokens: estimateOutputTokens(result.text),
    }).catch(err => logger.warn({ err: err.message }, 'Token tracking failed'));

    return {
      text: result.text,
      model: result.model,
      agent: route.agent,
      tokenBudget,
      responseTimeMs: Date.now() - startTime,
      language: lang,
      intent: route.topic || route.agent,
    };
  } catch (err) {
    logger.error({ err: err.message, agent: route.agent }, 'Agent generation failed');

    const fallbacks = {
      hi: 'Ek minute, phir se try karti hoon... thodi der baad message kijiye 🙏',
      ta: 'Oru nimisham, mendum try panniren... konjam neram kazhithu message pannunga 🙏',
      en: 'Give me a moment... please try again shortly 🙏',
    };

    return {
      text: fallbacks[lang] || fallbacks.en,
      model: 'fallback',
      agent: route.agent,
      tokenBudget: 0,
      responseTimeMs: Date.now() - startTime,
      language: lang,
      intent: route.agent,
    };
  }
}

// Rough token estimation (1 token ≈ 4 chars for English, 2 chars for Hindi/Devanagari)
function estimateInputTokens(systemPrompt, userMessage, history) {
  const totalChars = systemPrompt.length + userMessage.length +
    history.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 3); // Conservative estimate
}

function estimateOutputTokens(text) {
  return Math.ceil(text.length / 3);
}
