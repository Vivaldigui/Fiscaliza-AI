import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../infrastructure/redis.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import type { WhatsappSessionService } from './whatsapp-session.service';

const phone = '+5535999999999';
const phoneHash = createHash('sha256').update(phone).digest('hex');

function canonical(payload: {
  messageId: string;
  phone: string;
  text: string;
  timestamp: string;
  instance: string;
  metadata: Record<string, unknown>;
}) {
  const sorted = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

type MockPrisma = {
  inboundMessage: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  whatsappIdentity: { findFirst: jest.Mock };
  conversation: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  conversationMessage: { create: jest.Mock };
  outboxEvent: { create: jest.Mock };
  notification: { create: jest.Mock; findUnique: jest.Mock };
  systemSetting: { findUnique: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

function buildPrisma() {
  const mock: MockPrisma = {
    inboundMessage: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    whatsappIdentity: { findFirst: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    conversationMessage: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    notification: { create: jest.fn(), findUnique: jest.fn() },
    systemSetting: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  return mock;
}

function runTransaction(mock: MockPrisma, transaction: unknown) {
  mock.$transaction.mockImplementation(
    (operation: (value: unknown) => unknown) => operation(transaction) as never,
  );
}

function validIdentity() {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    councilorId: '30000000-0000-4000-8000-000000000001',
    phoneNumber: phone,
    instance: 'camara-principal',
    verifiedAt: new Date(),
    active: true,
    councilor: {
      userId: '10000000-0000-4000-8000-000000000001',
      active: true,
      user: { id: '10000000-0000-4000-8000-000000000001', status: 'ACTIVE' },
    },
  };
}

const dto = {
  messageId: 'wamid.123',
  phone,
  text: 'O que não responderam?',
  timestamp: '2026-08-12T10:30:00-03:00',
  instance: 'camara-principal',
  metadata: {},
};

function buildService(prisma: MockPrisma, enabled = true) {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'WHATSAPP_ENABLED') return enabled;
      if (key === 'WHATSAPP_RATE_LIMIT') return 20;
      if (key === 'WHATSAPP_SESSION_TTL_SECONDS') return 3600;
      return 0;
    }),
  } as unknown as ConfigService;
  const redis = {
    client: {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    },
  } as unknown as RedisService;
  const sessions = {
    touch: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  } as unknown as WhatsappSessionService;
  const service = new WhatsappInboundService(
    prisma as unknown as PrismaService,
    redis,
    sessions,
    config,
  );
  return { service, redis, sessions };
}

describe('WhatsappInboundService', () => {
  it('aceita inbound válido, cria conversa/mensagens e enfileira resposta (cenário 1)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue(validIdentity());
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationMessage.create.mockResolvedValueOnce({ id: 'user-msg' });
    prisma.conversationMessage.create.mockResolvedValueOnce({ id: 'assistant-msg' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      whatsappIdentity: prisma.whatsappIdentity,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service, sessions } = buildService(prisma);

    const result = await service.receive(dto);

    expect(result.accepted).toBe(true);
    expect(result.pending).toBe(true);
    const event = prisma.outboxEvent.create.mock.calls[0]?.[0]?.data;
    expect(event.eventType).toBe('ConversationAnswerRequested');
    expect(event.payload.conversationMessageId).toBe('assistant-msg');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(sessions.touch).toHaveBeenCalledWith(
      'camara-principal',
      '20000000-0000-4000-8000-000000000001',
      { conversationId: 'conversation-1' },
    );
  });

  it('rejeita quando WHATSAPP_ENABLED=false', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma, false);
    await expect(service.receive(dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('duplicata com mesmo payload retorna mesmo resultado sem reenfileirar (cenário 4)', async () => {
    const prisma = buildPrisma();
    const hash = canonical({ ...dto, phone });
    prisma.inboundMessage.findUnique.mockResolvedValue({
      id: 'inbound-1',
      payloadHash: hash,
      status: 'COMPLETED',
    });
    prisma.auditLog.create.mockResolvedValue({});
    const { service } = buildService(prisma);

    const result = await service.receive(dto);

    expect(result.duplicate).toBe(true);
    expect(prisma.inboundMessage.create).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('mesmo messageId com payload diferente é conflito (cenário 5)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue({
      id: 'inbound-1',
      payloadHash: '0000000000000000000000000000000000000000000000000000000000000000',
      status: 'COMPLETED',
    });
    prisma.auditLog.create.mockResolvedValue({});
    const { service } = buildService(prisma);

    await expect(service.receive(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('mesmo messageId em instâncias diferentes é aceito duas vezes (cenário 6)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue(validIdentity());
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationMessage.create.mockResolvedValue({ id: 'assistant-msg' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service } = buildService(prisma);

    const first = await service.receive({ ...dto, instance: 'camara-a' });
    expect(first.accepted).toBe(true);

    // Instância diferente => chave de idempotência diferente; novo processamento.
    prisma.inboundMessage.findUnique.mockClear();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    const second = await service.receive({ ...dto, instance: 'camara-b' });
    expect(second.accepted).toBe(true);
    expect(prisma.conversationMessage.create).toHaveBeenCalledTimes(4);
  });

  it('telefone desconhecido: nega, não busca documento e cria resposta neutra (cenário 7)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue(null);
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.notification.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      whatsappIdentity: prisma.whatsappIdentity,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service } = buildService(prisma);

    const result = await service.receive(dto);

    expect(result.neutralReply).toBe(true);
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
    // Nenhum evento de resposta de conversa (nenhum LLM/RAG será enfileirado).
    const events = prisma.outboxEvent.create.mock.calls.map((call) => call[0]?.data?.eventType);
    expect(events).toEqual(['NotificationCreated']);
    const audit = prisma.auditLog.create.mock.calls.map((call) => call[0]?.data?.action);
    expect(audit).toContain('WHATSAPP_IDENTITY_DENIED');
    const notificationData = prisma.notification.create.mock.calls[0]?.[0]?.data;
    expect(notificationData.destinationPhone).toBe(phone);
    expect(notificationData.templateVersion).toContain('deny');
  });

  it('identidade inativa é negada sem consulta (cenário 8)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue({ ...validIdentity(), active: false });
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.notification.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service } = buildService(prisma);

    const result = await service.receive(dto);

    expect(result.neutralReply).toBe(true);
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.create.mock.calls.map((call) => call[0]?.data?.eventType)).toEqual([
      'NotificationCreated',
    ]);
  });

  it('identidade não verificada é negada sem consulta (cenário 9)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue({ ...validIdentity(), verifiedAt: null });
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.notification.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service } = buildService(prisma);

    const result = await service.receive(dto);

    expect(result.neutralReply).toBe(true);
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
  });

  it('armazena apenas hash do telefone no envelope (privacidade)', async () => {
    const prisma = buildPrisma();
    prisma.inboundMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappIdentity.findFirst.mockResolvedValue(validIdentity());
    prisma.inboundMessage.create.mockResolvedValue({ id: 'inbound-1' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conversation-1' });
    prisma.conversationMessage.create.mockResolvedValueOnce({ id: 'user-msg' });
    prisma.conversationMessage.create.mockResolvedValueOnce({ id: 'assistant-msg' });
    prisma.inboundMessage.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    runTransaction(prisma, {
      inboundMessage: prisma.inboundMessage,
      conversation: prisma.conversation,
      conversationMessage: prisma.conversationMessage,
      outboxEvent: prisma.outboxEvent,
      notification: prisma.notification,
      systemSetting: prisma.systemSetting,
      auditLog: prisma.auditLog,
    });
    const { service } = buildService(prisma);

    await service.receive(dto);

    const created = prisma.inboundMessage.create.mock.calls[0]?.[0]?.data;
    expect(created.phoneHash).toBe(phoneHash);
    expect(created.phoneHash).not.toContain(phone);
  });
});
