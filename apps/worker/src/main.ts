import { PrismaClient } from '@fiscaliza/database';
import {
  asDocumentProcessingError,
  ClamAvDocumentSecurityScanner,
  DisabledDocumentSecurityScanner,
  DisabledOcrProvider,
  DOCUMENT_QUEUE,
  type DocumentQueuePayload,
  TesseractCliOcrProvider,
} from '@fiscaliza/document-processing';
import { UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from './config';
import { DocumentPipeline } from './document-pipeline';
import { DocumentProcessingStateService } from './document-state';
import { WorkerHealthServer } from './health-server';
import { InboxWatcher } from './inbox-watcher';
import { StructuredLogger } from './logger';
import { createDocumentQueue, OutboxDispatcher } from './outbox-dispatcher';
import { PdfJsSubprocessExtractor } from './pdf-extractor';
import { WorkerObjectStorage } from './storage';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new StructuredLogger(config.LOG_LEVEL);
  const prisma = new PrismaClient();
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const storage = new WorkerObjectStorage(config);
  const state = new DocumentProcessingStateService(prisma);
  const scanner = config.DOCUMENT_ANTIVIRUS_ENABLED
    ? new ClamAvDocumentSecurityScanner({
        host: config.CLAMAV_HOST,
        port: config.CLAMAV_PORT,
        timeoutMs: config.CLAMAV_TIMEOUT_MS,
      })
    : new DisabledDocumentSecurityScanner();
  const ocr = config.DOCUMENT_OCR_ENABLED
    ? new TesseractCliOcrProvider()
    : new DisabledOcrProvider();
  const pipeline = new DocumentPipeline(
    prisma,
    state,
    storage,
    new PdfJsSubprocessExtractor(config),
    scanner,
    ocr,
    config,
    logger,
  );
  const queue = createDocumentQueue(redis);
  const outbox = new OutboxDispatcher(prisma, queue, redis, config, logger);
  const inbox = new InboxWatcher(prisma, storage, config, logger);
  const health = new WorkerHealthServer(prisma, redis, storage, config, logger);
  const worker = new Worker<DocumentQueuePayload>(
    DOCUMENT_QUEUE,
    async (job) => {
      const jobId = job.id ?? 'unknown';
      if (job.attemptsMade > 0) {
        await state.prepareAutomaticRetry(job.data.documentId, job.data.attempt);
      }
      try {
        await pipeline.process(job.data.documentId, job.data.attempt, jobId);
      } catch (error) {
        const documentError = asDocumentProcessingError(error);
        await state.recordRetryError(
          job.data.documentId,
          job.data.attempt,
          documentError.code,
          documentError.message,
        );
        logger.error('Tentativa documental falhou.', {
          documentId: job.data.documentId,
          attempt: job.data.attempt,
          jobId,
          stage: 'job',
          errorCode: documentError.code,
          retryable: documentError.retryable,
          attemptsMade: job.attemptsMade + 1,
        });
        if (!documentError.retryable) {
          await state.markFailure(
            job.data.documentId,
            job.data.attempt,
            documentError.code,
            documentError.message,
          );
          throw new UnrecoverableError(documentError.message);
        }
        throw documentError;
      }
    },
    {
      connection: redis,
      concurrency: config.DOCUMENT_WORKER_CONCURRENCY,
      lockDuration: Math.max(30_000, config.DOCUMENT_PROCESSING_TIMEOUT),
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const maximumAttempts = Number(job.opts.attempts ?? 1);
    if (job.attemptsMade >= maximumAttempts && error.name !== 'UnrecoverableError') {
      const documentError = asDocumentProcessingError(error);
      void state.finalizeRecordedFailure(
        job.data.documentId,
        job.data.attempt,
        documentError.code,
        documentError.message,
      );
    }
  });
  worker.on('error', (error) => logger.error('Worker BullMQ falhou.', { error: error.message }));

  await Promise.all([prisma.$connect(), redis.ping(), storage.assertBucketAvailable()]);
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  outbox.start();
  if (config.DOCUMENT_WATCHER_ENABLED) await inbox.start();
  else logger.warn('Watcher da inbox desabilitado explicitamente.', { stage: 'inbox' });
  if (!config.DOCUMENT_ANTIVIRUS_ENABLED) {
    logger.warn('Antivírus documental desabilitado explicitamente.', { stage: 'security-scan' });
  }
  if (!config.DOCUMENT_OCR_ENABLED)
    logger.warn('OCR desabilitado explicitamente.', { stage: 'ocr' });
  health.start();
  logger.info('Worker documental pronto.', {
    queue: DOCUMENT_QUEUE,
    concurrency: config.DOCUMENT_WORKER_CONCURRENCY,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Encerrando worker documental.', { signal });
    outbox.stop();
    await Promise.allSettled([inbox.stop(), worker.close(), queue.close(), health.stop()]);
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'document-worker',
      message: 'Falha fatal ao iniciar worker.',
      error: error instanceof Error ? error.message : 'erro desconhecido',
    })}\n`,
  );
  process.exitCode = 1;
});
