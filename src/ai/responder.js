import { getProvider } from './geminiProvider.js';
import { buildMainPrompt, buildHookPrompt, buildChartContext } from './prompts.js';
import { logger } from '../utils/logger.js';

export async function generateResponse(userMessage, user, classification, conversationHistory = []) {
  const lang = user.language || classification.language || 'en';
  const chartData = typeof user.chart_data === 'string' ? JSON.parse(user.chart_data) : user.chart_data;
  const chartContext = buildChartContext(chartData);
  const birthTimeStatus = user.birth_time_known === false ? 'unknown' : 'known';

  // Format conversation history
  const historyStr = conversationHistory
    .map(m => `${m.role === 'user' ? 'User' : 'Tara'}: ${m.content}`)
    .join('\n');

  // Extract initial_intent from user preferences (stored during onboarding)
  const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
  const initialIntent = prefs.initial_intent || null;
  const gender = user.gender || null;

  const systemPrompt = buildMainPrompt(lang, chartContext, birthTimeStatus, historyStr, classification.intent, initialIntent, gender);

  const provider = getProvider();

  try {
    const result = await provider.generate(systemPrompt, userMessage, {
      complexity: classification.complexity,
      history: conversationHistory.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.8,
    });

    return {
      text: result.text,
      model: result.model,
      responseTimeMs: result.responseTimeMs,
      intent: classification.intent,
      language: lang,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Response generation failed');

    // Fallback responses by language
    const fallbacks = {
      hi: 'Ek minute, phir se try karti hoon... thodi der baad message kijiye 🙏',
      ta: 'Oru nimisham, mendum try panniren... konjam neram kazhithu message pannunga 🙏',
      en: 'Give me a moment... please try again shortly 🙏',
      te: 'Oka nimisham... konchem tarvata try cheyandi 🙏',
      bn: 'Ek minute... ektu pore abar try korun 🙏',
    };

    return {
      text: fallbacks[lang] || fallbacks.en,
      model: 'fallback',
      responseTimeMs: 0,
      intent: classification.intent,
      language: lang,
    };
  }
}

export async function generateHook(chartData, lang, script = 'latin') {
  const chartContext = buildChartContext(chartData);
  const hookPrompt = buildHookPrompt(lang, script);

  const fullPrompt = `${hookPrompt}\n\n---\n\nCHART DATA:\n${chartContext}`;

  const provider = getProvider();

  try {
    const result = await provider.generate(
      'You are Tara. The user already knows you. Do NOT re-introduce yourself or say your name. Jump directly into the chart insight.',
      fullPrompt,
      { complexity: 'complex', temperature: 0.9 }
    );

    return result.text;
  } catch (err) {
    logger.error({ err: err.message }, 'Hook generation failed');
    return null;
  }
}
