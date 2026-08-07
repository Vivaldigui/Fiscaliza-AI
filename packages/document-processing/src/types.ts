export interface ExtractedPage {
  pageNumber: number;
  extractedText: string | null;
  ocrText: string | null;
  effectiveText: string;
  extractionConfidence: number | null;
}

export interface AssociationSignalScores {
  identity: number;
  protocol: number;
  author: number;
  subject: number;
  textualReference: number;
}
