import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { WhatsappCallbackService } from './whatsapp-callback.service';

const notification = {
  id: '40000000-0000-4000-8000-000000000001',
  idempotencyKey: 'notification-key-1',
  type: 'WHATSAPP_CONVERSATION_REPLY',
  status: 'SENT',
  attempts: 1,
  payload: { text: 'oi' },
};

type MockPrisma = {
  notification: { findUnique: jest.Mock; updateMany: jest.Mock };
  auditLog: { create: jest.Mock };
};

function buildPrisma(overrides: Partial<MockPrisma> = {}) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(notification),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as MockPrisma;
}

function buildService(prisma: MockPrisma) {
  return new WhatsappCallbackService(prisma as unknown as PrismaService);
}

describe('WhatsappCallbackService', () => {
  it('aplica SENT com externalMessageId', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const result = await service.apply({
      notificationId: notification.id,
      idempotencyKey: notification.idempotencyKey,
      status: 'SENT',
      externalMessageId: 'wamid.external',
    });
    expect(result.status).toBe('SENT');
    const update = prisma.notification.updateMany.mock.calls[0]?.[0];
    expect(update.data.status).toBe('SENT');
    expect(update.data.externalMessageId).toBe('wamid.external');
  });

  it('aplica DELIVERED a partir de SENT', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const result = await service.apply({
      notificationId: notification.id,
      idempotencyKey: notification.idempotencyKey,
      status: 'DELIVERED',
    });
    expect(result.status).toBe('DELIVERED');
  });

  it('callback atrasado não regride DELIVERED para SENT (cenário 27)', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, status: 'DELIVERED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(
      service.apply({
        notificationId: notification.id,
        idempotencyKey: notification.idempotencyKey,
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('callback inválido: FAILED a partir de DELIVERED é rejeitado (cenário 26)', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, status: 'DELIVERED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(
      service.apply({
        notificationId: notification.id,
        idempotencyKey: notification.idempotencyKey,
        status: 'FAILED',
        error: 'provedor rejeitou',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita chave de idempotência divergente', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    await expect(
      service.apply({
        notificationId: notification.id,
        idempotencyKey: 'outra-chave',
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 para notificação inexistente', async () => {
    const prisma = buildPrisma({
      notification: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
    });
    const service = buildService(prisma);
    await expect(
      service.apply({
        notificationId: '40000000-0000-4000-8000-000000000099',
        idempotencyKey: 'x',
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('conflito quando o update concorrente não altera nenhuma linha', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue(notification),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(
      service.apply({
        notificationId: notification.id,
        idempotencyKey: notification.idempotencyKey,
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sanitiza erro antes de persistir (sem telefone/token)', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, status: 'PROCESSING' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const service = buildService(prisma);
    await service.apply({
      notificationId: notification.id,
      idempotencyKey: notification.idempotencyKey,
      status: 'FAILED',
      error: 'falha ao enviar para +5535999999999 com token=abc123',
    });
    const update = prisma.notification.updateMany.mock.calls[0]?.[0];
    expect(update.data.status).toBe('FAILED');
    expect(update.data.lastError).not.toContain('5535999999999');
    expect(update.data.lastError).not.toContain('abc123');
  });
});
