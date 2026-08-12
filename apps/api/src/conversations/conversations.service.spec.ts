import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import type { PrismaService } from '../database/prisma.service';
import type { RedisService } from '../infrastructure/redis.service';
import type { ObjectStorageService } from '../infrastructure/object-storage.service';
import type { AuthorizationService } from '../authorization/authorization.service';
import { ConversationsService } from './conversations.service';

const user: AuthenticatedUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'user@example.com',
  name: 'Usuário',
  roles: ['COUNCILOR'],
  councilorId: '20000000-0000-4000-8000-000000000001',
  tokenVersion: 1,
};

const otherUser: AuthenticatedUser = {
  ...user,
  id: '10000000-0000-4000-8000-000000000002',
  councilorId: '20000000-0000-4000-8000-000000000002',
};

const conversationId = '30000000-0000-4000-8000-000000000001';
const propositionId = '40000000-0000-4000-8000-000000000001';
const documentId = '50000000-0000-4000-8000-000000000001';

type MockPrisma = {
  conversation: {
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  conversationMessage: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
  outboxEvent: { create: jest.Mock };
  document: { findUnique: jest.Mock };
  proposition: { findUnique: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

function buildPrisma() {
  const mock: MockPrisma = {
    conversation: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversationMessage: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    document: { findUnique: jest.fn() },
    proposition: { findUnique: jest.fn() },
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

function buildService(prisma: MockPrisma) {
  const authorization = {
    canReadProposition: jest.fn().mockReturnValue(true),
  } as unknown as AuthorizationService;
  const redis = {
    client: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') },
  } as unknown as RedisService;
  const storage = {
    createSignedDownloadUrl: jest.fn().mockResolvedValue('https://storage/minio/original.pdf'),
  } as unknown as ObjectStorageService;
  const config = {
    getOrThrow: jest.fn((key: string) => (key === 'SIGNED_URL_TTL_SECONDS' ? 300 : 1_800)),
  } as unknown as ConfigService;
  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    authorization,
    redis,
    storage,
    config,
  );
  return { service, authorization, redis, storage };
}

const ownedConversation = {
  id: conversationId,
  userId: user.id,
  propositionId,
  channel: 'WEB',
  title: 'Nova conversa',
  lastInteractionAt: new Date(),
  createdAt: new Date(),
};

const fullConversation = {
  ...ownedConversation,
  proposition: { id: propositionId, type: 'REQUEST', number: 20, year: 2026 },
  messages: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      role: 'USER',
      content: 'Qual o status?',
      status: null,
      sources: null,
      provider: null,
      model: null,
      answerVersion: null,
      failureReason: null,
      latencyMs: null,
      createdAt: new Date(),
    },
  ],
};

describe('ConversationsService', () => {
  it('cria uma conversa sem proposição e toca a sessão Redis', async () => {
    const prisma = buildPrisma();
    prisma.conversation.create.mockResolvedValue(ownedConversation);
    prisma.conversation.findUnique.mockResolvedValue(ownedConversation);
    prisma.proposition.findUnique.mockResolvedValue({
      id: propositionId,
      authors: [{ councilorId: user.councilorId }],
    });
    prisma.auditLog.create.mockResolvedValue({});
    runTransaction(prisma, {
      conversation: { create: prisma.conversation.create },
      auditLog: { create: prisma.auditLog.create },
    });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue(fullConversation);
    const { service, redis } = buildService(prisma);

    const result = await service.create({}, user);

    expect(result.id).toBe(conversationId);
    expect(redis.client.set).toHaveBeenCalledWith(
      `conversation:web:${user.id}`,
      conversationId,
      'EX',
      1_800,
    );
  });

  it('bloqueia o contexto de proposição fora do escopo de leitura', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findUnique.mockResolvedValue({
      id: propositionId,
      authors: [{ councilorId: '20000000-0000-4000-8000-000000000099' }],
    });
    const { service, authorization } = buildService(prisma);
    jest.mocked(authorization.canReadProposition).mockReturnValue(false);

    await expect(service.create({ propositionId }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('nega acesso a conversa de outro usuário', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue(ownedConversation);
    const { service } = buildService(prisma);

    await expect(service.get(conversationId, otherUser)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deduplica mensagem idêntica sem enfileirar segunda resposta', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      ...ownedConversation,
      propositionId: null,
    });
    prisma.conversationMessage.findFirst.mockResolvedValue({
      id: '60000000-0000-4000-8000-000000000001',
    });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue(fullConversation);
    const { service } = buildService(prisma);

    await service.sendMessage(conversationId, { content: 'Qual o status?' }, user);

    expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('cria mensagem duplicável e enfileira resposta quando nova', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue({ ...ownedConversation, propositionId: null });
    prisma.conversationMessage.findFirst.mockResolvedValue(null);
    prisma.conversationMessage.create.mockResolvedValue({
      id: '60000000-0000-4000-8000-000000000002',
    });
    prisma.outboxEvent.create.mockResolvedValue({});
    prisma.conversation.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    runTransaction(prisma, {
      conversationMessage: { create: prisma.conversationMessage.create },
      outboxEvent: { create: prisma.outboxEvent.create },
      conversation: { update: prisma.conversation.update },
      auditLog: { create: prisma.auditLog.create },
    });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue(fullConversation);
    const { service } = buildService(prisma);

    await service.sendMessage(conversationId, { content: 'Qual o status?' }, user);

    expect(prisma.conversationMessage.create).toHaveBeenCalledTimes(2);
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
    const eventPayload = prisma.outboxEvent.create.mock.calls[0]?.[0]?.data;
    expect(eventPayload.eventType).toBe('ConversationAnswerRequested');
    expect(eventPayload.aggregateId).toBe(conversationId);
  });

  it('emite URL assinada apenas para documento citado como fonte', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue({ ...ownedConversation, propositionId: null });
    prisma.document.findUnique.mockResolvedValue({
      id: documentId,
      securityStatus: 'CLEAN',
      storageKey: `documents/2026/${documentId}/original.pdf`,
      originalName: 'requerimento.pdf',
    });
    prisma.conversationMessage.findMany.mockResolvedValue([
      { sources: [{ documentId, documentPageId: 'p-1', pageNumber: 1 }] },
    ]);
    prisma.auditLog.create.mockResolvedValue({});
    const { service } = buildService(prisma);

    const result = await service.downloadSource(conversationId, documentId, user);

    expect(result.url).toContain('https://');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('nega URL assinada para documento fora da conversa', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue({ ...ownedConversation, propositionId: null });
    prisma.document.findUnique.mockResolvedValue({
      id: documentId,
      securityStatus: 'CLEAN',
      storageKey: 'x',
      originalName: 'y.pdf',
    });
    prisma.conversationMessage.findMany.mockResolvedValue([
      { sources: [{ documentId: 'outro-documento', documentPageId: 'p-9', pageNumber: 9 }] },
    ]);
    const { service } = buildService(prisma);

    await expect(service.downloadSource(conversationId, documentId, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('retorna 404 para documento inexistente ou bloqueado pela segurança', async () => {
    const prisma = buildPrisma();
    prisma.conversation.findUnique.mockResolvedValue({ ...ownedConversation, propositionId: null });
    prisma.document.findUnique.mockResolvedValue(null);
    const { service } = buildService(prisma);

    await expect(service.downloadSource(conversationId, documentId, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
