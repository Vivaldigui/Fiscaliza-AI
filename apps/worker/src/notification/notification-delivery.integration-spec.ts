import { randomUUID } from 'node:crypto';
import { PrismaClient, RoleCode } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import type { NotificationDeliveryProvider } from './notification-delivery-provider';
import { NotificationDeliveryPipeline } from './notification-delivery-pipeline';

const logger = new StructuredLogger('error');

const config = {
  NOTIFICATION_QUEUE_ATTEMPTS: 3,
  NOTIFICATION_QUEUE_BACKOFF_MS: 1_000,
} as unknown as WorkerConfig;

describe('Entrega de notificações (PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const userIds: string[] = [];
  const councilorIds: string[] = [];
  const identityIds: string[] = [];
  const notificationIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.role.upsert({
      where: { code: RoleCode.COUNCILOR },
      update: {},
      create: { code: RoleCode.COUNCILOR, name: 'Vereador' },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.whatsappIdentity.deleteMany({ where: { id: { in: identityIds } } });
    await prisma.councilor.deleteMany({ where: { id: { in: councilorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createNotification(status: 'PENDING' | 'DELIVERED' = 'PENDING') {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${randomUUID()}@test.local`,
        name: 'Vereador',
        passwordHash: 'x',
        status: 'ACTIVE',
        councilor: { create: { displayName: 'Vereador' } },
      },
      include: { councilor: true },
    });
    userIds.push(user.id);
    councilorIds.push(user.councilor!.id);
    const identity = await prisma.whatsappIdentity.create({
      data: {
        councilorId: user.councilor!.id,
        phoneNumber: `+55${(10000000000 + Math.floor(Math.random() * 9_000_000_000)).toString()}`,
        instance: 'camara-principal',
        verifiedAt: new Date(),
        active: true,
      },
    });
    identityIds.push(identity.id);
    const notification = await prisma.notification.create({
      data: {
        type: 'WHATSAPP_CONVERSATION_REPLY',
        channel: 'WHATSAPP',
        identityId: identity.id,
        template: 'whatsapp-conversation-reply.v1',
        templateVersion: 'phase5b-whatsapp-reply-v1',
        payload: { text: 'resposta de teste', instance: 'camara-principal' },
        idempotencyKey: `test-delivery-${randomUUID()}`,
        status,
      },
    });
    notificationIds.push(notification.id);
    return notification;
  }

  it('entrega com sucesso: PROCESSING -> SENT com tentativa e auditoria', async () => {
    const notification = await createNotification();
    const deliver = jest.fn().mockResolvedValue({ accepted: true, externalMessageId: 'wamid.ext' });
    const provider = { name: 'n8n', deliver } as unknown as NotificationDeliveryProvider;
    const pipeline = new NotificationDeliveryPipeline(prisma, provider, config, logger);

    await pipeline.process(notification.id, 'job-1');

    const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(updated.status).toBe('SENT');
    expect(updated.externalMessageId).toBe('wamid.ext');
    expect(updated.attempts).toBe(1);
    const attempts = await prisma.notificationDeliveryAttempt.findMany({
      where: { notificationId: notification.id },
      orderBy: { attempt: 'asc' },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('SENT');
    const audit = await prisma.auditLog.count({
      where: { resourceId: notification.id, action: 'NOTIFICATION_SENT' },
    });
    expect(audit).toBe(1);
  });

  it('job duplicado de notificação já DELIVERED é ignorado (idempotência)', async () => {
    const notification = await createNotification('DELIVERED');
    const deliver = jest.fn().mockResolvedValue({ accepted: true, externalMessageId: null });
    const provider = { name: 'n8n', deliver } as unknown as NotificationDeliveryProvider;
    const pipeline = new NotificationDeliveryPipeline(prisma, provider, config, logger);

    await pipeline.process(notification.id, 'job-dup');

    expect(deliver).not.toHaveBeenCalled();
    const updated = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(updated.status).toBe('DELIVERED');
  });

  it('duas execuções concorrentes: apenas a primeira chama o provedor', async () => {
    const notification = await createNotification();
    const deliver = jest.fn().mockResolvedValue({ accepted: true, externalMessageId: null });
    const provider = { name: 'n8n', deliver } as unknown as NotificationDeliveryProvider;
    const pipeline = new NotificationDeliveryPipeline(prisma, provider, config, logger);

    await Promise.all([
      pipeline.process(notification.id, 'job-a'),
      pipeline.process(notification.id, 'job-b'),
    ]);

    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
