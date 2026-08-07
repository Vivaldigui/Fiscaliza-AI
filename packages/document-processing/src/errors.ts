import type { DocumentErrorCode } from './types';

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

export function asDocumentProcessingError(error: unknown): DocumentProcessingError {
  if (error instanceof DocumentProcessingError) return error;
  return new DocumentProcessingError(
    'TEXT_EXTRACTION_FAILED',
    error instanceof Error ? error.message : 'Falha desconhecida no processamento documental.',
    true,
  );
}
