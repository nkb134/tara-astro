import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from './llmProvider.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

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
          maxOutputTokens: 200,
          temperature: 0.1,
        },
      });

      const text = result.response.text().trim();
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

    try {
      const startTime = Date.now();

      // Gemini 2.5 Pro uses thinking tokens from the output budget.
      // Set thinking budget separately so output doesn't get starved.
      const genConfig = {
        maxOutputTokens: maxTokens,
        temperature: options.temperature || 0.8,
      };

      // For Pro model, cap thinking to prevent it from eating the entire budget
      if (modelName === MODELS.pro) {
        genConfig.thinkingConfig = {
          thinkingBudget: Math.min(1024, Math.floor(maxTokens * 0.4)),
        };
      }

      const result = await model.generateContent({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: genConfig,
      });

      let text = '';
      try {
        text = result.response.text().trim();
      } catch (textErr) {
        // Gemini 2.5 Pro may return thinking-only responses
        // Try to extract from candidates
        const candidate = result.response.candidates?.[0];
        if (candidate?.content?.parts) {
          text = candidate.content.parts
            .filter(p => p.text)
            .map(p => p.text)
            .join('\n')
            .trim();
        }
        if (!text) {
          logger.warn({ err: textErr.message, modelName, finishReason: candidate?.finishReason }, 'Empty response from Gemini');
        }
      }
      const elapsed = Date.now() - startTime;

      logger.info({ model: modelName, responseTimeMs: elapsed, tokensOut: text.length }, 'Gemini generate completed');

      return {
        text,
        model: modelName,
        responseTimeMs: elapsed,
      };
    } catch (err) {
      logger.error({ err: err.message, model: modelName }, 'Gemini generate failed');

      // Retry once with flash if pro fails
      if (modelName === MODELS.pro) {
        logger.info('Retrying with flash model');
        return this.generate(systemPrompt, userMessage, { ...options, complexity: 'simple' });
      }
      throw err;
    }
  }
}

let _provider = null;

export function getProvider() {
  if (!_provider) {
    _provider = new GeminiProvider();
  }
  return _provider;
}
