export interface DocumentListItem {
  id: string;
  originalName: string;
  sizeBytes: string;
  pageCount: number | null;
  processingStatus: string;
  textExtractionStatus: string;
  ocrStatus: string;
  securityStatus: string;
  reviewRequired: boolean;
  processingError: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentListResponse {
  items: DocumentListItem[];
  total: number;
  page: number;
  limit: number;
}

export const processingLabels: Record<string, string> = {
  RECEIVED: 'Recebido',
  QUARANTINED: 'Em quarentena',
  SECURITY_SCAN: 'Verificação de segurança',
  EXTRACTING: 'Extraindo texto',
  OCR: 'Executando OCR',
  CHUNKING: 'Gerando trechos',
  COMPLETED: 'Concluído',
  NEEDS_REVIEW: 'Precisa de revisão',
  FAILED: 'Falhou',
};

export function statusTone(status: string): string {
  if (status === 'COMPLETED' || status === 'CLEAN') return 'bg-emerald-50 text-emerald-800';
  if (status === 'FAILED' || status === 'INFECTED') return 'bg-red-50 text-red-800';
  if (status === 'NEEDS_REVIEW' || status === 'PARTIAL' || status === 'SKIPPED') {
    return 'bg-amber/10 text-amber';
  }
  return 'bg-blue-50 text-blue-800';
}

export function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
