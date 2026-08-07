import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@fiscaliza/database';
import { ProcessingStatus } from '@fiscaliza/database';
import type { DocumentIngestionService } from '@fiscaliza/document-processing';
import type { WorkerConfig } from './config';
import { InboxWatcher } from './inbox-watcher';
import type { StructuredLogger } from './logger';
import type { WorkerObjectStorage } from './storage';

describe('InboxWatcher', () => {
  it('aguarda estabilidade da cópia antes de ingerir o PDF', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-inbox-test-'));
    const ingest = jest.fn().mockResolvedValue({
      documentId: 'document-1',
      duplicate: false,
      sha256: 'a'.repeat(64),
      processingStatus: ProcessingStatus.QUARANTINED,
    });
    const watcher = new InboxWatcher(
      {} as PrismaClient,
      {} as WorkerObjectStorage,
      config(root),
      logger(),
      { ingest } as unknown as DocumentIngestionService,
    );
    const candidate = path.join(root, 'recebendo.pdf');
    try {
      await watcher.start();
      await writeFile(candidate, Buffer.from('%PDF-'));
      await wait(100);
      expect(ingest).not.toHaveBeenCalled();
      await appendFile(candidate, Buffer.from('1.7\nconteúdo sintético'));
      await waitFor(() => ingest.mock.calls.length === 1);
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: candidate,
          originalName: 'recebendo.pdf',
          source: 'INBOX',
        }),
      );
    } finally {
      await watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignora arquivos não PDF existentes na raiz', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-inbox-test-'));
    const ingest = jest.fn();
    await writeFile(path.join(root, '.gitkeep'), '\n');
    const watcher = new InboxWatcher(
      {} as PrismaClient,
      {} as WorkerObjectStorage,
      config(root),
      logger(),
      { ingest } as unknown as DocumentIngestionService,
    );
    try {
      await watcher.start();
      await wait(450);
      expect(ingest).not.toHaveBeenCalled();
    } finally {
      await watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

function config(root: string): WorkerConfig {
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
    DOCUMENT_INBOX_PATH: root,
    DOCUMENT_MAX_SIZE_MB: 25,
    DOCUMENT_MAX_PAGES: 500,
    DOCUMENT_PROCESSING_TIMEOUT: 30_000,
    DOCUMENT_WATCHER_ENABLED: true,
    DOCUMENT_WATCHER_STABILITY_MS: 300,
    DOCUMENT_WATCHER_POLL_INTERVAL_MS: 20,
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
  };
}

function logger(): StructuredLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Watcher não processou o arquivo estável.');
    await wait(25);
  }
}
