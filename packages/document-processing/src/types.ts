export interface ExtractedPage {
  pageNumber: number;
  extractedText: string | null;
  ocrText: string | null;
  effectiveText: string;
  extractionConfidence: number | null;
  qualityScore?: number;
  characterCount?: number;
  requiresOcr?: boolean;
  qualityReason?: string;
}

export type DocumentErrorCode =
  | 'INVALID_DOCUMENT_TYPE'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_DUPLICATE'
  | 'DOCUMENT_CORRUPTED'
  | 'DOCUMENT_PAGE_LIMIT_EXCEEDED'
  | 'SECURITY_SCAN_FAILED'
  | 'DOCUMENT_INFECTED'
  | 'TEXT_EXTRACTION_FAILED'
  | 'OCR_FAILED'
  | 'PROCESSING_TIMEOUT';

export type DocumentIngestionSourceValue = 'UPLOAD' | 'INBOX';

export interface IngestionInput {
  filePath: string;
  originalName: string;
  declaredMimeType?: string;
  source: DocumentIngestionSourceValue;
  actorId?: string;
  requestId?: string;
}

export interface IngestionResult {
  documentId: string;
  duplicate: boolean;
  sha256: string;
  processingStatus: string;
}

export interface TextQualityResult {
  characterCount: number;
  printableRatio: number;
  wordCount: number;
  qualityScore: number;
  requiresOcr: boolean;
  reason: string;
}

export interface DocumentQueuePayload {
  outboxEventId: string;
  documentId: string;
  attempt: number;
  correlationId: string;
}

export interface AssociationSignalScores {
  identity: number;
  protocol: number;
  author: number;
  subject: number;
  textualReference: number;
}
