import type { PrismaClient } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import type { NotificationDeliveryProvider } from './notification-delivery-provider';
import { NotificationDeliveryPipeline } from './notification-delivery-pipeline';

const logger = new StructuredLogger('error');

const config = {
  NOTIFICATION_QUEUE_ATTEMPTS: 3,
  NOTIFICATION_QUEUE_BACKOFF_MS: 1_000,
} as unknown as WorkerConfig;

const notification = {
  id: '40000000-0000-4000-8000-000000000001',
  type: 'WHATSAPP_CONVERSATION_REPLY',
  channel: 'WHATSAPP',
  idempotencyKey: 'key-1',
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: null,
  identityId: '20000000-0000-4000-8000-000000000001',
  destinationPhone: null,
  payload: { text: 'oi' },
  externalMessageId: null,
  lastError: null,
};

function fakeProvider(deliver?: jest.Mock) {
  const provider = {
    name: 'n8n',
    deliver:
      deliver ?? jest.fn().mockResolvedValue({ accepted: true, externalMessageId: 'wamid.ext' }),
  } as unknown as NotificationDeliveryProvider;
  return { provider, deliver: provider.deliver };
}

type MockPrisma = {
  notification: { findUnique: jest.Mock; updateMany: jest.Mock };
  notificationDeliveryAttempt: { create: jest.Mock; updateMany: jest.Mock };
  auditLog: { create: jest.Mock };
  whatsappIdentity: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function buildPrisma(overrides: Partial<MockPrisma> = {}) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(notification),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notificationDeliveryAttempt: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    whatsappIdentity: {
      findUnique: jest.fn().mockResolvedValue({
        id: '20000000-0000-4000-8000-000000000001',
        phoneNumber: '+5535999999999',
        instance: 'camara-principal',
        active: true,
        verifiedAt: new Date(),
      }),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    ...overrides,
  } as MockPrisma;
}

function buildPipeline(prisma: MockPrisma, provider: NotificationDeliveryProvider) {
  return new NotificationDeliveryPipeline(
    prisma as unknown as PrismaClient,
    provider,
    config,
    logger,
  );
}

describe('NotificationDeliveryPipeline', () => {
  it('entrega com sucesso: PROCESSING -> SENT + tentativa registrada', async () => {
    const prisma = buildPrisma();
    const { provider, deliver } = fakeProvider();
    const pipeline = buildPipeline(prisma, provider);
    await pipeline.process(notification.id, 'job-1');

    expect(deliver).toHaveBeenCalledTimes(1);
    const claim = prisma.notification.updateMany.mock.calls[0]?.[0];
    expect(claim.data.status).toBe('PROCESSING');
    const success = prisma.notification.updateMany.mock.calls[1]?.[0];
    expect(success.data.status).toBe('SENT');
    expect(prisma.notificationDeliveryAttempt.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls.map((call) => call[0]?.data?.action)).toContain(
      'NOTIFICATION_SENT',
    );
  });

  it('falha temporária agenda retry com backoff exponencial (cenário 24)', async () => {
    const prisma = buildPrisma();
    const { provider } = fakeProvider(jest.fn().mockRejectedValue(new Error('timeout')));
    const pipeline = buildPipeline(prisma, provider);

    await expect(pipeline.process(notification.id, 'job-1')).rejects.toThrow('timeout');

    const retryUpdate = prisma.notification.updateMany.mock.calls[1]?.[0];
    expect(retryUpdate.data.status).toBe('PENDING');
    expect(retryUpdate.data.nextAttemptAt).toBeInstanceOf(Date);
    const attempt = prisma.notificationDeliveryAttempt.create.mock.calls[1]?.[0]?.data;
    expect(attempt.status).toBe('FAILED');
  });

  it('esgota tentativas e marca FAILED (cenário 25)', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, attempts: 3 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const { provider } = fakeProvider(jest.fn().mockRejectedValue(new Error('rejeitado')));
    const pipeline = buildPipeline(prisma, provider);

    await expect(pipeline.process(notification.id, 'job-1')).rejects.toThrow('rejeitado');

    const finalUpdate = prisma.notification.updateMany.mock.calls[1]?.[0];
    expect(finalUpdate.data.status).toBe('FAILED');
    expect(prisma.auditLog.create.mock.calls.map((call) => call[0]?.data?.action)).toContain(
      'NOTIFICATION_FAILED',
    );
  });

  it('não reenviar identidade revogada (UnrecoverableError)', async () => {
    const prisma = buildPrisma({
      whatsappIdentity: {
        findUnique: jest.fn().mockResolvedValue({
          id: '20000000-0000-4000-8000-000000000001',
          phoneNumber: '+5535999999999',
          instance: 'camara-principal',
          active: false,
          verifiedAt: new Date(),
        }),
      },
    });
    const { provider, deliver } = fakeProvider();
    const pipeline = buildPipeline(prisma, provider);

    await pipeline.process(notification.id, 'job-1');

    expect(deliver).not.toHaveBeenCalled();
    const finalUpdate = prisma.notification.updateMany.mock.calls[1]?.[0];
    expect(finalUpdate.data.status).toBe('FAILED');
  });

  it('duas entregas concorrentes: apenas uma chama o provedor (cenário 28)', async () => {
    const prisma = buildPrisma();
    prisma.notification.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { provider, deliver } = fakeProvider();
    const pipeline = buildPipeline(prisma, provider);

    // Primeira execução reivindica (count 1) e entrega.
    await pipeline.process(notification.id, 'job-1');
    // Segunda execução carrega o mesmo estado (attempts 0) mas perde o claim.
    await pipeline.process(notification.id, 'job-2');

    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('ignora notificações já DELIVERED ou CANCELLED (idempotência)', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, status: 'DELIVERED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const { provider, deliver } = fakeProvider();
    const pipeline = buildPipeline(prisma, provider);
    await pipeline.process(notification.id, 'job-1');
    expect(deliver).not.toHaveBeenCalled();
  });
});
