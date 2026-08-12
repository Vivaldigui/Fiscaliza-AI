import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoleCode } from '@fiscaliza/database';
import type { PrismaService } from '../database/prisma.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const notification = {
  id: '40000000-0000-4000-8000-000000000001',
  type: 'RESPONSE_ANALYSIS_COMPLETED',
  channel: 'WHATSAPP',
  template: 'response-analysis-completed.v1',
  templateVersion: 'phase5b-response-analysis-v1',
  status: 'PENDING',
  attempts: 1,
  nextAttemptAt: new Date(),
  externalMessageId: null,
  lastError: null,
  sentAt: null,
  deliveredAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  payload: { text: 'x' },
  recipientId: null,
  identityId: '20000000-0000-4000-8000-000000000001',
  destinationPhone: null,
  analysisId: null,
  deadlineId: null,
  recipient: null,
  identity: null,
  deliveryAttempts: [],
};

type MockPrisma = {
  notification: { findUnique: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  outboxEvent: { create: jest.Mock };
  auditLog: { create: jest.Mock };
};

function buildPrisma(overrides: Partial<MockPrisma> = {}) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(notification),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as MockPrisma;
}

function buildService(prisma: MockPrisma) {
  return new NotificationsService(prisma as unknown as PrismaService);
}

describe('NotificationsService', () => {
  it('retry reenfileira via outbox e reseta tentativas', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    await service.retry(notification.id);
    const update = prisma.notification.updateMany.mock.calls[0]?.[0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.attempts).toBe(0);
    const event = prisma.outboxEvent.create.mock.calls[0]?.[0]?.data;
    expect(event.eventType).toBe('NotificationRetryRequested');
  });

  it('cancel só funciona antes do envio', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    await service.cancel(notification.id);
    const update = prisma.notification.updateMany.mock.calls[0]?.[0];
    expect(update.data.status).toBe('CANCELLED');
    expect(update.where.status.in).toEqual(['PENDING', 'PROCESSING']);
  });

  it('cancel rejeita notificação já enviada', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue({ ...notification, status: 'SENT' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = buildService(prisma);
    await expect(service.cancel(notification.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 para notificação inexistente', async () => {
    const prisma = buildPrisma({
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    });
    const service = buildService(prisma);
    await expect(service.retry('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não expõe payload integral na listagem', async () => {
    const prisma = buildPrisma({
      notification: {
        ...buildPrisma().notification,
        findMany: jest.fn().mockResolvedValue([notification]),
      },
    });
    const service = buildService(prisma);
    const result = await service.list({});
    expect(result.items[0]).toBeDefined();
    expect(JSON.stringify(result.items[0])).not.toContain('"text"');
  });
});

describe('NotificationsController RBAC/IDOR (cenário 29)', () => {
  const roles = Reflect.getMetadata('roles', NotificationsController.prototype.list) as RoleCode[];
  it('consulta aberta apenas para ADMIN/SECRETARIAT/AUDITOR', () => {
    expect(roles).toEqual([RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR]);
  });

  it('retry e cancel exigem ADMIN/SECRETARIAT (AUDITOR é read-only)', () => {
    const retryRoles = Reflect.getMetadata(
      'roles',
      NotificationsController.prototype.retry,
    ) as RoleCode[];
    const cancelRoles = Reflect.getMetadata(
      'roles',
      NotificationsController.prototype.cancel,
    ) as RoleCode[];
    expect(retryRoles).toEqual([RoleCode.ADMIN, RoleCode.SECRETARIAT]);
    expect(cancelRoles).toEqual([RoleCode.ADMIN, RoleCode.SECRETARIAT]);
    expect(retryRoles).not.toContain(RoleCode.AUDITOR);
    expect(retryRoles).not.toContain(RoleCode.COUNCILOR);
  });
});
