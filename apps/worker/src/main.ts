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
import { createEmbeddingProvider, createLLMProvider } from '@fiscaliza/ai';
import { UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AiAnalysisPipeline } from './ai/ai-pipeline';
import { AI_QUEUE, type AiQueuePayload } from './ai/ai-queue';
import { loadConfig } from './config';
import { DocumentPipeline } from './document-pipeline';
import { createDeadlineMaintenance } from './deadline-maintenance';
import { DocumentProcessingStateService } from './document-state';
import { EmbeddingsIndexer } from './embeddings/embeddings-indexer';
import { EMBEDDINGS_QUEUE, type EmbeddingsQueuePayload } from './embeddings/embeddings-queue';
import { ConversationAnswerPipeline } from './conversation/conversation-answer-pipeline';
import {
  CONVERSATION_QUEUE,
  type ConversationQueuePayload,
} from './conversation/conversation-queue';
import { WorkerHealthServer } from './health-server';
import { InboxWatcher } from './inbox-watcher';
import { StructuredLogger } from './logger';
import { N8nWebhookDeliveryProvider } from './notification/notification-delivery-provider';
import { NotificationDeliveryPipeline } from './notification/notification-delivery-pipeline';
import { NotificationFactory } from './notification/notification-factory';
import {
  NOTIFICATION_FACTORY_QUEUE,
  type NotificationFactoryPayload,
} from './notification/notification-factory-queue';
import {
  NOTIFICATION_QUEUE,
  type NotificationQueuePayload,
} from './notification/notification-queue';
import { createNotificationReconciliation } from './notification/notification-reconciliation';
import {
  createAiQueue,
  createConversationQueue,
  createDocumentQueue,
  createEmbeddingsQueue,
  createNotificationFactoryQueue,
  createNotificationQueue,
  OutboxDispatcher,
} from './outbox-dispatcher';
import { PdfJsSubprocessExtractor } from './pdf-extractor';
import { WorkerObjectStorage } from './storage';
import { WhatsappContextResolver } from './whatsapp/whatsapp-context-resolver';

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
  const aiQueue = createAiQueue(redis);
  const embeddingsQueue = createEmbeddingsQueue(redis);
  const conversationQueue = createConversationQueue(redis);
  const notificationQueue = createNotificationQueue(redis);
  const notificationFactoryQueue = createNotificationFactoryQueue(redis);
  const llmProvider = createLLMProvider({
    provider: config.LLM_PROVIDER,
    model: config.LLM_MODEL,
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
    ...(config.LLM_API_KEY ? { apiKey: config.LLM_API_KEY } : {}),
  });
  const embeddingsProvider = createEmbeddingProvider({
    provider: config.EMBEDDINGS_PROVIDER,
    model: config.EMBEDDINGS_MODEL,
    dimension: config.EMBEDDINGS_DIMENSION,
    timeoutMs: config.EMBEDDINGS_TIMEOUT_MS,
    ...(config.EMBEDDINGS_API_KEY ? { apiKey: config.EMBEDDINGS_API_KEY } : {}),
  });
  const aiPipeline = new AiAnalysisPipeline(prisma, llmProvider, config, logger);
  const embeddingsIndexer = new EmbeddingsIndexer(prisma, config, logger);
  const whatsappContext = new WhatsappContextResolver(prisma, redis, config, logger);
  const conversationPipeline = new ConversationAnswerPipeline(
    prisma,
    llmProvider,
    embeddingsProvider,
    config,
    logger,
    whatsappContext,
  );
  const deliveryProvider = new N8nWebhookDeliveryProvider({
    baseUrl: config.N8N_WEBHOOK_BASE_URL ?? '',
    secret: config.N8N_WEBHOOK_SECRET ?? '',
    timeoutMs: config.N8N_REQUEST_TIMEOUT_MS,
    logger,
  });
  const notificationPipeline = new NotificationDeliveryPipeline(
    prisma,
    deliveryProvider,
    config,
    logger,
  );
  const notificationFactory = new NotificationFactory(prisma, config, logger);
  const outbox = new OutboxDispatcher(
    prisma,
    queue,
    aiQueue,
    embeddingsQueue,
    conversationQueue,
    notificationQueue,
    notificationFactoryQueue,
    redis,
    config,
    logger,
  );
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

  const aiWorker = new Worker<AiQueuePayload>(
    AI_QUEUE,
    async (job) => {
      await aiPipeline.process(job.data.analysisId, job.id ?? 'unknown');
    },
    {
      connection: redis,
      concurrency: config.AI_JOB_CONCURRENCY,
      lockDuration: Math.max(30_000, config.AI_REQUEST_TIMEOUT_MS * 4),
    },
  );
  aiWorker.on('error', (error) => logger.error('Worker de IA falhou.', { error: error.message }));

  const embeddingsWorker = new Worker<EmbeddingsQueuePayload>(
    EMBEDDINGS_QUEUE,
    async (job) => {
      await embeddingsIndexer.process(job.data.documentId, job.data.attempt, job.id ?? 'unknown');
    },
    {
      connection: redis,
      concurrency: config.EMBEDDINGS_WORKER_CONCURRENCY,
      lockDuration: Math.max(30_000, config.EMBEDDINGS_TIMEOUT_MS * 2),
    },
  );
  embeddingsWorker.on('error', (error) =>
    logger.error('Worker de embeddings falhou.', { error: error.message }),
  );

  const conversationWorker = new Worker<ConversationQueuePayload>(
    CONVERSATION_QUEUE,
    async (job) => {
      await conversationPipeline.process(job.data.conversationMessageId, job.id ?? 'unknown');
    },
    {
      connection: redis,
      concurrency: config.CHAT_WORKER_CONCURRENCY,
      lockDuration: Math.max(30_000, config.AI_REQUEST_TIMEOUT_MS * 4),
    },
  );
  conversationWorker.on('error', (error) =>
    logger.error('Worker de respostas web falhou.', { error: error.message }),
  );

  const notificationWorker = new Worker<NotificationQueuePayload>(
    NOTIFICATION_QUEUE,
    async (job) => {
      await notificationPipeline.process(job.data.notificationId, job.id ?? 'unknown');
    },
    {
      connection: redis,
      concurrency: config.NOTIFICATION_WORKER_CONCURRENCY,
      lockDuration: Math.max(30_000, config.N8N_REQUEST_TIMEOUT_MS * 2),
    },
  );
  notificationWorker.on('error', (error) =>
    logger.error('Worker de entrega de notificações falhou.', { error: error.message }),
  );
  notificationWorker.on('failed', (job, error) => {
    if (!job) return;
    void notificationPipeline.recordFinalFailure(job.data.notificationId, error);
  });

  const notificationFactoryWorker = new Worker<NotificationFactoryPayload>(
    NOTIFICATION_FACTORY_QUEUE,
    async (job) => {
      const payload = job.data;
      if (payload.eventType === 'ResponseAnalysisCompleted' && payload.analysisId) {
        await notificationFactory.processResponseAnalysis(payload.analysisId, job.id ?? 'unknown');
      } else if (
        (payload.eventType === 'DeadlineApproaching' || payload.eventType === 'DeadlineExpired') &&
        payload.deadlineId
      ) {
        await notificationFactory.processDeadline(
          payload.eventType,
          payload.deadlineId,
          payload.dueDate ?? '',
          job.id ?? 'unknown',
        );
      }
    },
    {
      connection: redis,
      concurrency: config.NOTIFICATION_WORKER_CONCURRENCY,
      lockDuration: 30_000,
    },
  );
  notificationFactoryWorker.on('error', (error) =>
    logger.error('Worker de criação de notificações falhou.', { error: error.message }),
  );

  await Promise.all([prisma.$connect(), redis.ping(), storage.assertBucketAvailable()]);
  await Promise.all([
    queue.waitUntilReady(),
    worker.waitUntilReady(),
    aiQueue.waitUntilReady(),
    aiWorker.waitUntilReady(),
    embeddingsQueue.waitUntilReady(),
    embeddingsWorker.waitUntilReady(),
    conversationQueue.waitUntilReady(),
    conversationWorker.waitUntilReady(),
    notificationQueue.waitUntilReady(),
    notificationWorker.waitUntilReady(),
    notificationFactoryQueue.waitUntilReady(),
    notificationFactoryWorker.waitUntilReady(),
  ]);
  const deadlineMaintenance = await createDeadlineMaintenance(prisma, redis, config, logger);
  const notificationReconciliation = await createNotificationReconciliation(
    prisma,
    notificationQueue,
    redis,
    config,
    logger,
  );
  outbox.start();
  if (config.DOCUMENT_WATCHER_ENABLED) await inbox.start();
  else logger.warn('Watcher da inbox desabilitado explicitamente.', { stage: 'inbox' });
  if (!config.DOCUMENT_ANTIVIRUS_ENABLED) {
    logger.warn('Antivírus documental desabilitado explicitamente.', { stage: 'security-scan' });
  }
  if (!config.DOCUMENT_OCR_ENABLED)
    logger.warn('OCR desabilitado explicitamente.', { stage: 'ocr' });
  if (!config.AI_PROCESSING_ENABLED) {
    logger.warn('Processamento por IA desabilitado explicitamente (AI_PROCESSING_ENABLED=false).', {
      stage: 'ai',
    });
  }
  if (!config.EMBEDDINGS_ENABLED) {
    logger.warn(
      'Indexação por embeddings desabilitada explicitamente (EMBEDDINGS_ENABLED=false).',
      { stage: 'embeddings' },
    );
  }
  if (!config.CHAT_ENABLED) {
    logger.warn('Conversas web desabilitadas explicitamente (CHAT_ENABLED=false).', {
      stage: 'conversation',
    });
  }
  if (!config.WHATSAPP_ENABLED) {
    logger.warn('WhatsApp desabilitado explicitamente (WHATSAPP_ENABLED=false).', {
      stage: 'whatsapp',
    });
  }
  if (!config.RESPONSE_NOTIFICATIONS_ENABLED) {
    logger.warn('Notificações de resposta desabilitadas (RESPONSE_NOTIFICATIONS_ENABLED=false).', {
      stage: 'notifications',
    });
  }
  if (!config.DEADLINE_NOTIFICATIONS_ENABLED) {
    logger.warn('Alertas de prazo desabilitados (DEADLINE_NOTIFICATIONS_ENABLED=false).', {
      stage: 'notifications',
    });
  }
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
    await Promise.allSettled([
      inbox.stop(),
      worker.close(),
      queue.close(),
      aiWorker.close(),
      aiQueue.close(),
      embeddingsWorker.close(),
      embeddingsQueue.close(),
      conversationWorker.close(),
      conversationQueue.close(),
      notificationWorker.close(),
      notificationQueue.close(),
      notificationFactoryWorker.close(),
      notificationFactoryQueue.close(),
      notificationReconciliation.worker.close(),
      notificationReconciliation.queue.close(),
      deadlineMaintenance.worker.close(),
      deadlineMaintenance.queue.close(),
      health.stop(),
    ]);
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
