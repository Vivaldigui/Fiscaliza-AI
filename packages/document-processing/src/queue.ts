import type { DocumentQueuePayload } from './types';

export const DOCUMENT_QUEUE = 'document-processing';
export const DOCUMENT_JOB = 'process-document';
export const DOCUMENT_UPLOADED_EVENT = 'DocumentUploaded';

export function documentJobId(
  payload: Pick<DocumentQueuePayload, 'documentId' | 'attempt'>,
): string {
  return `document-${payload.documentId}-attempt-${payload.attempt}`;
}
