export const EMBEDDINGS_QUEUE = 'embeddings-indexing';
export const EMBEDDINGS_JOB = 'index-document';

export interface EmbeddingsQueuePayload {
  outboxEventId: string;
  documentId: string;
  attempt: number;
  /**
   * Final `ProcessingStatus` from the `DocumentProcessed` outbox event; only
   * `COMPLETED` ever enqueues (the dispatcher gates by this + enabled flag).
   * The indexer still re-checks the database state, which is the source of
   * truth.
   */
  status: string;
}

/**
 * Deterministic per document+attempt so duplicate `DocumentProcessed` events
 * (outbox retry, backfill overlap) can never enqueue the same logical work
 * twice. Within the worker, idempotency is doubled by the `embedding_hash`
 * skip on chunks already carrying the current provider/model/version.
 */
export function embeddingsJobId(
  payload: Pick<EmbeddingsQueuePayload, 'documentId' | 'attempt'>,
): string {
  return `embed:${payload.documentId}:${payload.attempt}`;
}
