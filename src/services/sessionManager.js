import { getOrCreateConversation, saveMessage, getRecentMessages } from '../db/conversations.js';
import { logger } from '../utils/logger.js';

export async function getSessionContext(userId) {
  const conversation = await getOrCreateConversation(userId);

  if (!conversation?.id) {
    return { conversationId: null, history: [] };
  }

  const history = await getRecentMessages(conversation.id, 6);

  return {
    conversationId: conversation.id,
    history,
  };
}

export async function saveExchange(conversationId, userId, userMessage, botResponse, metadata = {}) {
  if (!conversationId) return;

  try {
    // Save user message
    await saveMessage(conversationId, userId, 'user', userMessage, {
      language: metadata.language,
    });

    // Save bot response
    await saveMessage(conversationId, userId, 'assistant', botResponse, {
      language: metadata.language,
      intent: metadata.intent,
      model: metadata.model,
      responseTimeMs: metadata.responseTimeMs,
    });
  } catch (err) {
    logger.error({ err: err.message, conversationId }, 'Failed to save exchange');
  }
}
