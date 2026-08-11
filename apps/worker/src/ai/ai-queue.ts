export const AI_QUEUE = 'ai-processing';
export const AI_JOB = 'analyze';

export interface AiQueuePayload {
  outboxEventId: string;
  analysisId: string;
  inputHash: string;
}

/**
 * Deterministic per analysis/input-hash so a duplicate `AnalysisRequested`
 * event (e.g. outbox retry) can never enqueue the same logical work twice;
 * BullMQ deduplicates by jobId while the job is active/waiting.
 */
export function aiJobId(payload: Pick<AiQueuePayload, 'analysisId' | 'inputHash'>): string {
  return `analysis:${payload.analysisId}:input:${payload.inputHash}`;
}
