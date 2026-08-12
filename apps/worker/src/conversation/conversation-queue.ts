export const CONVERSATION_QUEUE = 'conversation-answers';
export const CONVERSATION_JOB = 'answer';

export interface ConversationQueuePayload {
  outboxEventId: string;
  conversationMessageId: string;
}

/**
 * Deterministic per assistant message so a duplicate `ConversationAnswerRequested`
 * event (outbox retry) can never enqueue the same logical work twice. The
 * pipeline additionally ignores messages already COMPLETED.
 */
export function conversationJobId(
  payload: Pick<ConversationQueuePayload, 'conversationMessageId'>,
): string {
  return `conversation:${payload.conversationMessageId}`;
}
