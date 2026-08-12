import type { PrismaClient } from '@fiscaliza/database';
import type Redis from 'ioredis';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { WhatsappContextResolver } from './whatsapp-context-resolver';

const logger = new StructuredLogger('error');

const config = { WHATSAPP_SESSION_TTL_SECONDS: 3600 } as unknown as WorkerConfig;

const councilorUser = {
  id: '10000000-0000-4000-8000-000000000001',
  councilor: { id: '20000000-0000-4000-8000-000000000001' },
  roles: [{ role: { code: 'COUNCILOR' } }],
};

const propositionA = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'REQUEST',
  number: 38,
  year: 2026,
  subject: 'Manutenção da frota',
};
const propositionB = {
  id: '30000000-0000-4000-8000-000000000002',
  type: 'REQUEST',
  number: 38,
  year: 2026,
  subject: 'Iluminação pública',
};

type MockPrisma = {
  user: { findUnique: jest.Mock };
  proposition: { findMany: jest.Mock; findUnique: jest.Mock };
  propositionAuthor: { count: jest.Mock };
  conversation: { updateMany: jest.Mock };
};

function buildPrisma(overrides: Partial<MockPrisma> = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(councilorUser) },
    proposition: { findMany: jest.fn(), findUnique: jest.fn() },
    propositionAuthor: { count: jest.fn().mockResolvedValue(1) },
    conversation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  } as MockPrisma;
}

function fakeRedis(initial: Map<string, string> = new Map()) {
  const store = new Map(initial);
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    store,
  } as unknown as Redis;
}

function buildResolver(prisma: MockPrisma, redis: Redis) {
  return new WhatsappContextResolver(prisma as unknown as PrismaClient, redis, config, logger);
}

const baseParams = {
  conversationId: '40000000-0000-4000-8000-000000000001',
  userId: '10000000-0000-4000-8000-000000000001',
  propositionId: null,
  whatsappIdentityId: '20000000-0000-4000-8000-000000000002',
  instance: 'camara-principal',
  question: '',
};

describe('WhatsappContextResolver', () => {
  it('ativa contexto quando há exatamente uma proposição autorizada (cenário 13)', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findMany.mockResolvedValue([propositionA]);
    const redis = fakeRedis();
    const resolver = buildResolver(prisma, redis);

    const result = await resolver.resolve({
      ...baseParams,
      question: 'requerimento 38/2026',
    });

    expect(result.kind).toBe('context-activated');
    expect(result.text).toContain('Requerimento 38/2026');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: baseParams.conversationId, whatsappIdentityId: baseParams.whatsappIdentityId },
      data: { propositionId: propositionA.id, lastInteractionAt: expect.any(Date) },
    });
    const stored = redis.get(`whatsapp:session:camara-principal:${baseParams.whatsappIdentityId}`);
    await stored;
    expect(
      await redis.get(`whatsapp:session:camara-principal:${baseParams.whatsappIdentityId}`),
    ).toContain(propositionA.id);
  });

  it('contexto ambíguo gera pergunta de esclarecimento, sem seleção silenciosa (cenário 14)', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findMany.mockResolvedValue([propositionA, propositionB]);
    const resolver = buildResolver(prisma, fakeRedis());

    const result = await resolver.resolve({
      ...baseParams,
      question: 'requerimento 38/2026',
    });

    expect(result.kind).toBe('clarification');
    expect(result.text).toContain('mais de um registro');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('nenhum candidato autorizado recebe resposta explícita', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findMany.mockResolvedValue([]);
    const resolver = buildResolver(prisma, fakeRedis());

    const result = await resolver.resolve({
      ...baseParams,
      question: 'indicação 99/2026',
    });

    expect(result.kind).toBe('not-found');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('não seleciona proposição fora do escopo do vereador', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      councilor: { id: '20000000-0000-4000-8000-000000000099' },
      roles: [{ role: { code: 'COUNCILOR' } }],
    });
    prisma.proposition.findMany.mockResolvedValue([]);
    const resolver = buildResolver(prisma, fakeRedis());

    const result = await resolver.resolve({
      ...baseParams,
      question: 'requerimento 38/2026',
    });

    expect(result.kind).toBe('not-found');
  });

  it('sessão Redis expirada: restauração é no-op (cenário 15)', async () => {
    const prisma = buildPrisma();
    const redis = fakeRedis(new Map());
    const resolver = buildResolver(prisma, redis);

    const result = await resolver.resolve({ ...baseParams, question: 'O que não responderam?' });

    expect(result.kind).toBe('no-op');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('restaura proposição ativa da sessão quando ainda autorizada', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findUnique.mockResolvedValue({ id: propositionA.id });
    prisma.propositionAuthor.count.mockResolvedValue(1);
    const redis = fakeRedis(
      new Map([
        [
          `whatsapp:session:camara-principal:${baseParams.whatsappIdentityId}`,
          JSON.stringify({
            activePropositionId: propositionA.id,
            conversationId: null,
            lastInteraction: new Date().toISOString(),
          }),
        ],
      ]),
    );
    const resolver = buildResolver(prisma, redis);

    const result = await resolver.resolve({ ...baseParams, question: 'resuma' });

    expect(result.kind).toBe('no-op');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ propositionId: propositionA.id }),
      }),
    );
  });

  it('não restaura proposição da sessão se o acesso foi revogado', async () => {
    const prisma = buildPrisma();
    prisma.proposition.findUnique.mockResolvedValue({ id: propositionA.id });
    prisma.propositionAuthor.count.mockResolvedValue(0);
    const redis = fakeRedis(
      new Map([
        [
          `whatsapp:session:camara-principal:${baseParams.whatsappIdentityId}`,
          JSON.stringify({
            activePropositionId: propositionA.id,
            conversationId: null,
            lastInteraction: new Date().toISOString(),
          }),
        ],
      ]),
    );
    const resolver = buildResolver(prisma, redis);

    const result = await resolver.resolve({ ...baseParams, question: 'resuma' });

    expect(result.kind).toBe('no-op');
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});
