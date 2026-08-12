import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { WorkerConfig } from './config';
import { PdfJsSubprocessExtractor } from './pdf-extractor';

describe('PdfJsSubprocessExtractor', () => {
  it('preserva rigorosamente as três páginas da fixture crítica', async () => {
    await withPdf(
      [
        'Requerimento fictício 001/2026',
        'Solicito informações sobre a frota municipal.',
        'Fim do documento.',
      ],
      async (pdfPath) => {
        const result = await new PdfJsSubprocessExtractor(config()).extract(pdfPath);
        expect(result.pageCount).toBe(3);
        expect(result.pages.map(({ pageNumber }) => pageNumber)).toEqual([1, 2, 3]);
        expect(result.pages[0]?.text).toContain('Requerimento fictício 001/2026');
        expect(result.pages[1]?.text).toContain('frota municipal');
        expect(result.pages[2]?.text).toContain('Fim do documento');
      },
    );
  });

  it('extrai PDF textual de uma página', async () => {
    await withPdf(['Documento textual sintético'], async (pdfPath) => {
      const result = await new PdfJsSubprocessExtractor(config()).extract(pdfPath);
      expect(result.pageCount).toBe(1);
      expect(result.pages[0]?.text).toContain('Documento textual');
    });
  });

  it('mantém página sem texto vazia para decisão posterior de OCR', async () => {
    await withPdf([''], async (pdfPath) => {
      const result = await new PdfJsSubprocessExtractor(config()).extract(pdfPath);
      expect(result.pages[0]?.pageNumber).toBe(1);
      expect(result.pages[0]?.text).toBe('');
    });
  });

  it('rejeita PDF corrompido', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-corrupt-'));
    const pdfPath = path.join(directory, 'corrompido.pdf');
    try {
      await writeFile(pdfPath, Buffer.from('%PDF-1.7\ncorrompido'));
      await expect(new PdfJsSubprocessExtractor(config()).extract(pdfPath)).rejects.toMatchObject({
        code: 'DOCUMENT_CORRUPTED',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bloqueia PDF acima do limite de páginas', async () => {
    await withPdf(['página 1', 'página 2'], async (pdfPath) => {
      await expect(
        new PdfJsSubprocessExtractor(config({ DOCUMENT_MAX_PAGES: 1 })).extract(pdfPath),
      ).rejects.toMatchObject({ code: 'DOCUMENT_PAGE_LIMIT_EXCEEDED' });
    });
  });
});

async function withPdf(
  texts: string[],
  operation: (pdfPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-pdf-fixture-'));
  const pdfPath = path.join(directory, 'fixture.pdf');
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const text of texts) {
      const page = pdf.addPage([595, 842]);
      if (text) page.drawText(text, { x: 50, y: 780, size: 12, font });
    }
    await writeFile(pdfPath, await pdf.save());
    await operation(pdfPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://test.invalid/test',
    REDIS_URL: 'redis://test.invalid:6379',
    MINIO_ENDPOINT: 'test.invalid',
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: 'test',
    MINIO_SECRET_KEY: 'test-secret',
    MINIO_BUCKET: 'test-documents',
    MINIO_REGION: 'us-east-1',
    DOCUMENT_INBOX_PATH: './data/inbox',
    DOCUMENT_MAX_SIZE_MB: 25,
    DOCUMENT_MAX_PAGES: 500,
    DOCUMENT_PROCESSING_TIMEOUT: 30_000,
    DOCUMENT_WATCHER_ENABLED: false,
    DOCUMENT_WATCHER_STABILITY_MS: 500,
    DOCUMENT_WATCHER_POLL_INTERVAL_MS: 100,
    DOCUMENT_ANTIVIRUS_ENABLED: false,
    DOCUMENT_ANTIVIRUS_REQUIRED: false,
    CLAMAV_HOST: 'clamav',
    CLAMAV_PORT: 3310,
    CLAMAV_TIMEOUT_MS: 10_000,
    DOCUMENT_OCR_ENABLED: false,
    DOCUMENT_OCR_LANGUAGES: 'por',
    DOCUMENT_OCR_CONCURRENCY: 1,
    DOCUMENT_OCR_TIMEOUT_MS: 10_000,
    DOCUMENT_TEXT_MIN_CHARACTERS: 80,
    DOCUMENT_TEXT_MIN_WORDS: 8,
    DOCUMENT_TEXT_MIN_QUALITY: 0.55,
    DOCUMENT_CHUNK_SIZE: 1_200,
    DOCUMENT_CHUNK_OVERLAP: 150,
    DOCUMENT_QUEUE_ATTEMPTS: 3,
    DOCUMENT_QUEUE_BACKOFF_MS: 1_000,
    DOCUMENT_WORKER_CONCURRENCY: 1,
    OUTBOX_POLL_INTERVAL_MS: 1_000,
    OUTBOX_BATCH_SIZE: 20,
    WORKER_HEALTH_PORT: 3002,
    DEADLINE_SWEEP_INTERVAL_MS: 60_000,
    LLM_PROVIDER: 'fake',
    LLM_MODEL: 'fake-deterministic-v1',
    AI_PROCESSING_ENABLED: false,
    AI_REQUEST_TIMEOUT_MS: 60_000,
    AI_MAX_RETRIES: 2,
    AI_JOB_CONCURRENCY: 1,
    AI_MAX_PAGES_PER_BATCH: 20,
    AI_MAX_INPUT_CHARS: 60_000,
    AI_QUEUE_ATTEMPTS: 3,
    AI_QUEUE_BACKOFF_MS: 10_000,
    EMBEDDINGS_ENABLED: true,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_MODEL: 'fake-embedding-v1',
    EMBEDDINGS_DIMENSION: 1536,
    EMBEDDINGS_TIMEOUT_MS: 30_000,
    EMBEDDINGS_BATCH_SIZE: 16,
    EMBEDDINGS_QUEUE_ATTEMPTS: 3,
    EMBEDDINGS_QUEUE_BACKOFF_MS: 10_000,
    EMBEDDINGS_WORKER_CONCURRENCY: 1,
    CHAT_ENABLED: false,
    CHAT_WORKER_CONCURRENCY: 1,
    CONVERSATION_SESSION_TTL_SECONDS: 3_600,
    CONVERSATION_RAG_TOP_K: 8,
    CONVERSATION_MAX_CONTEXT_CHARS: 60_000,
    CONVERSATION_ANSWER_MAX_RETRIES: 2,
    CONVERSATION_QUEUE_ATTEMPTS: 3,
    CONVERSATION_QUEUE_BACKOFF_MS: 10_000,
    WHATSAPP_ENABLED: false,
    WHATSAPP_SESSION_TTL_SECONDS: 3_600,
    N8N_REQUEST_TIMEOUT_MS: 10_000,
    NOTIFICATION_QUEUE_ATTEMPTS: 3,
    NOTIFICATION_QUEUE_BACKOFF_MS: 10_000,
    NOTIFICATION_WORKER_CONCURRENCY: 1,
    NOTIFICATION_RECONCILIATION_INTERVAL_MS: 60_000,
    NOTIFICATION_PROCESSING_STALE_MS: 15 * 60_000,
    RESPONSE_NOTIFICATIONS_ENABLED: false,
    DEADLINE_NOTIFICATIONS_ENABLED: false,
    ...overrides,
  };
}
