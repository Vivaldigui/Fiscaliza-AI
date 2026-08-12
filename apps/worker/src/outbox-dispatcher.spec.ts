import type { PrismaClient } from '@fiscaliza/database';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerConfig } from './config';
import { StructuredLogger } from './logger';
import { OutboxDispatcher } from './outbox-dispatcher';

const logger = new StructuredLogger('error');

const config = {
  OUTBOX_POLL_INTERVAL_MS: 1_000,
  OUTBOX_BATCH_SIZE: 10,
  DOCUMENT_QUEUE_ATTEMPTS: 3,
  DOCUMENT_QUEUE_BACKOFF_MS: 1_000,
  AI_QUEUE_ATTEMPTS: 3,
  AI_QUEUE_BACKOFF_MS: 1_000,
  CONVERSATION_QUEUE_ATTEMPTS: 3,
  CONVERSATION_QUEUE_BACKOFF_MS: 1_000,
  EMBEDDINGS_QUEUE_ATTEMPTS: 3,
  EMBEDDINGS_QUEUE_BACKOFF_MS: 1_000,
  NOTIFICATION_QUEUE_ATTEMPTS: 3,
  NOTIFICATION_QUEUE_BACKOFF_MS: 1_000,
  EMBEDDINGS_ENABLED: false,
  CHAT_ENABLED: true,
  WHATSAPP_ENABLED: true,
  RESPONSE_NOTIFICATIONS_ENABLED: true,
  DEADLINE_NOTIFICATIONS_ENABLED: true,
} as unknown as WorkerConfig;

function event(id: string, eventType: string, payload: Record<string, unknown>) {
  return { id, event_type: eventType, aggregate_id: 'agg-1', payload, attempts: 0 };
}

function buildDispatcher(
  overrides: {
    notificationAdd?: jest.Mock;
    factoryAdd?: jest.Mock;
    conversationAdd?: jest.Mock;
  } = {},
) {
  const prisma = {
    $transaction: jest.fn((op: (t: unknown) => unknown) =>
      op({
        $queryRaw: jest.fn().mockResolvedValue([]),
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    ),
    outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const documentQueue = { add: jest.fn() } as unknown as Queue;
  const aiQueue = { add: jest.fn() } as unknown as Queue;
  const embeddingsQueue = { add: jest.fn() } as unknown as Queue;
  const conversationQueue = { add: overrides.conversationAdd ?? jest.fn() } as unknown as Queue;
  const notificationQueue = { add: overrides.notificationAdd ?? jest.fn() } as unknown as Queue;
  const notificationFactoryQueue = { add: overrides.factoryAdd ?? jest.fn() } as unknown as Queue;
  const redis = { xadd: jest.fn() } as unknown as Redis;
  const dispatcher = new OutboxDispatcher(
    prisma as unknown as PrismaClient,
    documentQueue,
    aiQueue,
    embeddingsQueue,
    conversationQueue,
    notificationQueue,
    notificationFactoryQueue,
    redis,
    config,
    logger,
  );
  return {
    dispatcher,
    prisma,
    conversationQueue,
    notificationQueue,
    notificationFactoryQueue,
    redis,
  };
}

describe('OutboxDispatcher (eventos da Fase 5B)', () => {
  it('NotificationCreated enfileira entrega com jobId determinístico', async () => {
    const { dispatcher, prisma, notificationQueue } = buildDispatcher();
    prisma.$transaction.mockImplementation((op: (t: unknown) => unknown) =>
      op({
        $queryRaw: jest
          .fn()
          .mockResolvedValue([
            event('evt-1', 'NotificationCreated', { notificationId: 'notif-1' }),
          ]),
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await dispatcher.tick();

    const add = jest.mocked(notificationQueue.add);
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = add.mock.calls[0]!;
    expect(jobName).toBe('deliver');
    expect((payload as { notificationId: string }).notificationId).toBe('notif-1');
    expect((options as { jobId: string }).jobId).toBe('notification:notif-1');
  });

  it('ResponseAnalysisCompleted enfileira criação idempotente de notificações', async () => {
    const { dispatcher, prisma, notificationFactoryQueue } = buildDispatcher();
    prisma.$transaction.mockImplementation((op: (t: unknown) => unknown) =>
      op({
        $queryRaw: jest.fn().mockResolvedValue([
          event('evt-2', 'ResponseAnalysisCompleted', {
            analysisId: 'analysis-1',
            propositionId: 'prop-1',
          }),
        ]),
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await dispatcher.tick();

    const add = jest.mocked(notificationFactoryQueue.add);
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, , options] = add.mock.calls[0]!;
    expect(jobName).toBe('create-notifications');
    expect((options as { jobId: string }).jobId).toBe('response-analysis:analysis-1');
  });

  it('DeadlineApproaching/DeadlineExpired enfileiram criação idempotente por prazo', async () => {
    const { dispatcher, prisma, notificationFactoryQueue } = buildDispatcher();
    prisma.$transaction.mockImplementation((op: (t: unknown) => unknown) =>
      op({
        $queryRaw: jest.fn().mockResolvedValue([
          event('evt-3', 'DeadlineApproaching', {
            deadlineId: 'dl-1',
            propositionId: 'prop-1',
            dueDate: '2026-09-01',
          }),
          event('evt-4', 'DeadlineExpired', {
            deadlineId: 'dl-2',
            propositionId: 'prop-1',
            dueDate: '2026-08-01',
          }),
        ]),
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await dispatcher.tick();

    const add = jest.mocked(notificationFactoryQueue.add);
    expect(add).toHaveBeenCalledTimes(2);
    const jobIds = add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId);
    expect(jobIds).toContain('deadline:dl-1:DeadlineApproaching:2026-09-01');
    expect(jobIds).toContain('deadline:dl-2:DeadlineExpired:2026-08-01');
  });

  it('evento desconhecido vaza para o stream Redis (sem quebrar o dispatcher)', async () => {
    const { dispatcher, prisma, redis } = buildDispatcher();
    prisma.$transaction.mockImplementation((op: (t: unknown) => unknown) =>
      op({
        $queryRaw: jest
          .fn()
          .mockResolvedValue([event('evt-9', 'DeadlineExtended', { deadlineId: 'dl-1' })]),
        outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await dispatcher.tick();

    expect(jest.mocked(redis.xadd)).toHaveBeenCalledTimes(1);
  });
});
