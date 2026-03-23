export class LLMProvider {
  async classify(message, context) {
    throw new Error('classify() not implemented');
  }

  async generate(systemPrompt, userMessage, options = {}) {
    throw new Error('generate() not implemented');
  }

  async embed(text) {
    throw new Error('embed() not implemented');
  }
}
