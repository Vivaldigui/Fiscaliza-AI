import type { PrismaClient } from '@fiscaliza/database';
import { NotificationStatus } from '@fiscaliza/database';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';
import {
  NOTIFICATION_JOB,
  notificationJobId,
  type NotificationQueuePayload,
} from './notification-queue';

export const NOTIFICATION_RECONCILIATION_QUEUE = 'notification-reconciliation';
const RECONCILIATION_JOB = 'reconcile-notifications';

/**
 * Periodic reconciliation of the delivery queue:
 *   - PENDING notifications past `nextAttemptAt` are re-enqueued (durable
 *     retry even if BullMQ state was lost);
 *   - PROCESSING notifications stuck beyond `NOTIFICATION_PROCESSING_STALE_MS`
 *     (crashed worker) are reset to PENDING;
 *   - PENDING notifications that exhausted their attempt budget become FAILED.
 * The delivery pipeline's guarded claim keeps this race-free.
 */
export async function createNotificationReconciliation(
  prisma: PrismaClient,
  deliveryQueue: Queue<NotificationQueuePayload>,
  redis: Redis,
  config: WorkerConfig,
  logger: StructuredLogger,
) {
  const queue = new Queue(NOTIFICATION_RECONCILIATION_QUEUE, { connection: redis });
  const worker = new Worker(
    NOTIFICATION_RECONCILIATION_QUEUE,
    async (job) => {
      if (job.name !== RECONCILIATION_JOB) return;
      const startedAt = performance.now();
      const result = await reconcileNotifications(prisma, deliveryQueue, config, new Date());
      logger.info('Reconciliação de notificações concluída.', {
        stage: 'notification-reconciliation',
        jobId: job.id,
        ...result,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    { connection: redis, concurrency: 1 },
  );
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  await queue.upsertJobScheduler(
    'notification-reconciliation-sweep',
    { every: config.NOTIFICATION_RECONCILIATION_INTERVAL_MS },
    { name: RECONCILIATION_JOB, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
  return { queue, worker };
}

export async function reconcileNotifications(
  prisma: PrismaClient,
  deliveryQueue: Queue<NotificationQueuePayload>,
  config: WorkerConfig,
  now: Date,
) {
  const due = await prisma.notification.findMany({
    where: {
      status: NotificationStatus.PENDING,
      nextAttemptAt: { lte: now },
      attempts: { lt: config.NOTIFICATION_QUEUE_ATTEMPTS },
    },
    select: { id: true },
    take: 500,
  });
  for (const notification of due) {
    await enqueue(deliveryQueue, notification.id, config);
  }

  const stale = await prisma.notification.findMany({
    where: {
      status: NotificationStatus.PROCESSING,
      updatedAt: { lt: new Date(now.getTime() - config.NOTIFICATION_PROCESSING_STALE_MS) },
    },
    select: { id: true },
    take: 500,
  });
  for (const notification of stale) {
    await prisma.notification.updateMany({
      where: { id: notification.id, status: NotificationStatus.PROCESSING },
      data: { status: NotificationStatus.PENDING, nextAttemptAt: now },
    });
    await enqueue(deliveryQueue, notification.id, config);
  }

  const exhausted = await prisma.notification.findMany({
    where: {
      status: NotificationStatus.PENDING,
      nextAttemptAt: { lte: now },
      attempts: { gte: config.NOTIFICATION_QUEUE_ATTEMPTS },
    },
    select: { id: true },
    take: 500,
  });
  for (const notification of exhausted) {
    await prisma.notification.updateMany({
      where: { id: notification.id, status: NotificationStatus.PENDING },
      data: {
        status: NotificationStatus.FAILED,
        lastError: 'Número máximo de tentativas atingido.',
      },
    });
  }

  return { enqueued: due.length, staleReset: stale.length, exhausted };
}

async function enqueue(
  deliveryQueue: Queue<NotificationQueuePayload>,
  notificationId: string,
  config: WorkerConfig,
): Promise<void> {
  await deliveryQueue.add(
    NOTIFICATION_JOB,
    { notificationId },
    {
      jobId: notificationJobId({ notificationId }),
      attempts: config.NOTIFICATION_QUEUE_ATTEMPTS,
      backoff: { type: 'exponential', delay: config.NOTIFICATION_QUEUE_BACKOFF_MS },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 7 * 86_400, count: 1_000 },
    },
  );
}
