import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from './llmProvider.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { geminiBreaker } from '../utils/circuitBreaker.js';

const MODELS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

export class GeminiProvider extends LLMProvider {
  constructor() {
    super();
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }

  async classify(message, context = '') {
    const model = this.genAI.getGenerativeModel({ model: MODELS.flash });

    const prompt = `${context}\n\nUser message: "${message}"`;

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.1,
          thinkingConfig: { thinkingBudget: 200 },
        },
      });

      let text = result.response.text().trim();
      // Strip markdown code fences that Gemini loves to add
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      logger.warn({ text }, 'Classifier did not return valid JSON');
      return null;
    } catch (err) {
      logger.error({ err: err.message }, 'Gemini classify failed');
      return null;
    }
  }

  async generate(systemPrompt, userMessage, options = {}) {
    const modelName = options.complexity === 'complex' ? MODELS.pro : MODELS.flash;
    const maxTokens = options.maxTokens || (options.complexity === 'complex' ? 3000 : 2000);
    const model = this.genAI.getGenerativeModel({ model: modelName });

    const history = options.history || [];
    const contents = [];

    // Build conversation history
    for (const msg of history) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // Add current user message
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    // Circuit breaker wraps the Gemini call
    return geminiBreaker.exec(
      async () => {
        const startTime = Date.now();
        const thinkingBudget = modelName === MODELS.pro ? 1024 : 512;
        const genConfig = {
          maxOutputTokens: maxTokens + thinkingBudget,
          temperature: options.temperature || 0.8,
          thinkingConfig: { thinkingBudget },
        };

        const result = await model.generateContent({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: genConfig,
        });

        let text = '';
        try {
          text = result.response.text().trim();
        } catch (textErr) {
          const candidate = result.response.candidates?.[0];
          if (candidate?.content?.parts) {
            text = candidate.content.parts.filter(p => p.text).map(p => p.text).join('\n').trim();
          }
          if (!text) {
            logger.warn({ err: textErr.message, modelName, finishReason: candidate?.finishReason }, 'Empty response');
          }
        }
        const elapsed = Date.now() - startTime;
        logger.info({ model: modelName, responseTimeMs: elapsed, tokensOut: text.length }, 'Gemini generate completed');
        return { text, model: modelName, responseTimeMs: elapsed };
      },
      () => {
        // Fallback when circuit is open — try flash if pro failed
        if (modelName === MODELS.pro) {
          logger.warn('Gemini circuit open for pro — falling back to flash');
          return this.generate(systemPrompt, userMessage, { ...options, complexity: 'simple' });
        }
        throw new Error('Gemini circuit breaker open');
      }
    );
  }
}

let _provider = null;

export function getProvider() {
  if (!_provider) {
    _provider = new GeminiProvider();
  }
  return _provider;
}
