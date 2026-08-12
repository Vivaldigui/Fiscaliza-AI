import type { PrismaClient } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { buildResponseAnalysisText, NotificationFactory } from './notification-factory';

const logger = new StructuredLogger('error');

const config = {
  RESPONSE_NOTIFICATIONS_ENABLED: true,
  DEADLINE_NOTIFICATIONS_ENABLED: true,
  WHATSAPP_ENABLED: true,
} as unknown as WorkerConfig;

const identity = {
  id: '20000000-0000-4000-8000-000000000001',
  instance: 'camara-principal',
  displayName: 'Vereador A',
};

function completedAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    type: 'REQUEST_RESPONSE',
    status: 'COMPLETED',
    propositionId: '40000000-0000-4000-8000-000000000001',
    proposition: {
      type: 'REQUEST',
      number: 38,
      year: 2026,
      subject: 'Manutenção da frota',
      authors: [
        {
          councilor: {
            displayName: 'Vereador A',
            whatsappIdentities: [
              { id: identity.id, instance: 'camara-principal', verifiedAt: new Date() },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

type MockPrisma = {
  analysis: { findUnique: jest.Mock };
  analysisItem: { groupBy: jest.Mock };
  propositionAuthor: { findMany: jest.Mock };
  deadline: { findUnique: jest.Mock };
  notification: { findUnique: jest.Mock; create: jest.Mock };
  outboxEvent: { create: jest.Mock };
  $transaction: jest.Mock;
};

function buildPrisma(overrides: Partial<MockPrisma> = {}) {
  return {
    analysis: { findUnique: jest.fn() },
    analysisItem: { groupBy: jest.fn() },
    propositionAuthor: { findMany: jest.fn() },
    deadline: { findUnique: jest.fn() },
    notification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
    ...overrides,
  } as MockPrisma;
}

function runTransaction(mock: MockPrisma, transaction: unknown) {
  mock.$transaction.mockImplementation(
    (operation: (value: unknown) => unknown) => operation(transaction) as never,
  );
}

function mockAuthors(prisma: MockPrisma, verified = true) {
  prisma.propositionAuthor.findMany.mockResolvedValue([
    {
      councilor: {
        displayName: 'Vereador A',
        whatsappIdentities: [
          {
            id: identity.id,
            instance: 'camara-principal',
            verifiedAt: verified ? new Date() : null,
          },
        ],
      },
    },
  ]);
}

function buildFactory(prisma: MockPrisma, cfg: WorkerConfig = config) {
  return new NotificationFactory(prisma as unknown as PrismaClient, cfg, logger);
}

describe('NotificationFactory', () => {
  it('cria notificação apenas para análise de resposta COMPLETED (cenário 18/19)', async () => {
    const prisma = buildPrisma();
    prisma.analysis.findUnique.mockResolvedValue(completedAnalysis());
    prisma.analysisItem.groupBy.mockResolvedValue([
      { currentStatus: 'ANSWERED', _count: { _all: 1 } },
      { currentStatus: 'PARTIALLY_ANSWERED', _count: { _all: 1 } },
      { currentStatus: 'NOT_ANSWERED', _count: { _all: 1 } },
    ]);
    mockAuthors(prisma);
    runTransaction(prisma, {
      notification: prisma.notification,
      outboxEvent: prisma.outboxEvent,
    });
    const factory = buildFactory(prisma);

    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');

    const created = prisma.notification.create.mock.calls[0]?.[0]?.data;
    expect(created.type).toBe('RESPONSE_ANALYSIS_COMPLETED');
    expect(created.identityId).toBe(identity.id);
    expect(created.idempotencyKey).toContain('response-analysis');
    // A criação e o outbox estão na mesma transação (job recuperável garantido).
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it('reprocessar o mesmo evento não duplica notificação (cenário 18)', async () => {
    const prisma = buildPrisma();
    prisma.analysis.findUnique.mockResolvedValue(completedAnalysis());
    prisma.analysisItem.groupBy.mockResolvedValue([
      { currentStatus: 'ANSWERED', _count: { _all: 2 } },
    ]);
    mockAuthors(prisma);
    prisma.notification.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'notif-1',
    });
    runTransaction(prisma, { notification: prisma.notification, outboxEvent: prisma.outboxEvent });
    const factory = buildFactory(prisma);

    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');
    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-2');

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('análise PENDING/PROCESSING/FAILED/NEEDS_HUMAN_REVIEW nunca notifica (cenário 19/20)', async () => {
    for (const status of ['PENDING', 'PROCESSING', 'FAILED', 'NEEDS_HUMAN_REVIEW']) {
      const prisma = buildPrisma();
      prisma.analysis.findUnique.mockResolvedValue(completedAnalysis({ status }));
      runTransaction(prisma, {
        notification: prisma.notification,
        outboxEvent: prisma.outboxEvent,
      });
      const factory = buildFactory(prisma);
      await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');
      expect(prisma.notification.create).not.toHaveBeenCalled();
    }
  });

  it('extração (REQUEST_EXTRACTION) não notifica (sem contrato de resposta)', async () => {
    const prisma = buildPrisma();
    prisma.analysis.findUnique.mockResolvedValue(completedAnalysis({ type: 'REQUEST_EXTRACTION' }));
    runTransaction(prisma, { notification: prisma.notification, outboxEvent: prisma.outboxEvent });
    const factory = buildFactory(prisma);
    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('contagem correta de respondido/parcial/não respondido (cenário 21)', () => {
    const text = buildResponseAnalysisText({
      propositionType: 'REQUEST',
      number: 38,
      year: 2026,
      subject: 'Manutenção da frota',
      counts: { ANSWERED: 1, PARTIALLY_ANSWERED: 1, NOT_ANSWERED: 1 },
    });
    expect(text).toContain('Requerimento 38/2026');
    expect(text).toContain('✅ 1 respondido');
    expect(text).toContain('🟡 1 parcialmente respondido');
    expect(text).toContain('🔴 1 sem resposta identificada');
  });

  it('DeadlineApproaching idempotente (cenário 22)', async () => {
    const prisma = buildPrisma();
    prisma.deadline.findUnique.mockResolvedValue({
      id: '50000000-0000-4000-8000-000000000001',
      propositionId: '40000000-0000-4000-8000-000000000001',
      proposition: {
        id: '40000000-0000-4000-8000-000000000001',
        type: 'REQUEST',
        number: 38,
        year: 2026,
        subject: 'Manutenção da frota',
      },
    });
    prisma.propositionAuthor.findMany.mockResolvedValue([
      {
        councilor: {
          displayName: 'Vereador A',
          whatsappIdentities: [
            { id: identity.id, instance: 'camara-principal', verifiedAt: new Date() },
          ],
        },
      },
    ]);
    prisma.notification.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'notif-1',
    });
    runTransaction(prisma, { notification: prisma.notification, outboxEvent: prisma.outboxEvent });
    const factory = buildFactory(prisma);

    await factory.processDeadline(
      'DeadlineApproaching',
      '50000000-0000-4000-8000-000000000001',
      '2026-09-01',
      'job-1',
    );
    await factory.processDeadline(
      'DeadlineApproaching',
      '50000000-0000-4000-8000-000000000001',
      '2026-09-01',
      'job-2',
    );

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const created = prisma.notification.create.mock.calls[0]?.[0]?.data;
    expect(created.type).toBe('DEADLINE_APPROACHING');
    expect(created.deadlineId).toBe('50000000-0000-4000-8000-000000000001');
  });

  it('DeadlineExpired idempotente (cenário 23)', async () => {
    const prisma = buildPrisma();
    prisma.deadline.findUnique.mockResolvedValue({
      id: '50000000-0000-4000-8000-000000000001',
      propositionId: '40000000-0000-4000-8000-000000000001',
      proposition: {
        id: '40000000-0000-4000-8000-000000000001',
        type: 'INDICATION',
        number: 12,
        year: 2026,
        subject: 'Iluminação',
      },
    });
    prisma.propositionAuthor.findMany.mockResolvedValue([
      {
        councilor: {
          displayName: 'Vereador A',
          whatsappIdentities: [
            { id: identity.id, instance: 'camara-principal', verifiedAt: new Date() },
          ],
        },
      },
    ]);
    prisma.notification.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'notif-1',
    });
    runTransaction(prisma, { notification: prisma.notification, outboxEvent: prisma.outboxEvent });
    const factory = buildFactory(prisma);

    await factory.processDeadline(
      'DeadlineExpired',
      '50000000-0000-4000-8000-000000000001',
      '2026-08-01',
      'job-1',
    );
    await factory.processDeadline(
      'DeadlineExpired',
      '50000000-0000-4000-8000-000000000001',
      '2026-08-01',
      'job-2',
    );

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0]?.[0]?.data.type).toBe('DEADLINE_EXPIRED');
  });

  it('identidade não verificada não recebe notificação (deny by default)', async () => {
    const prisma = buildPrisma();
    prisma.analysis.findUnique.mockResolvedValue(
      completedAnalysis({
        proposition: {
          type: 'REQUEST',
          number: 38,
          year: 2026,
          subject: 'Manutenção da frota',
          authors: [
            {
              councilor: {
                displayName: 'Vereador A',
                whatsappIdentities: [
                  { id: identity.id, instance: 'camara-principal', verifiedAt: null },
                ],
              },
            },
          ],
        },
      }),
    );
    prisma.analysisItem.groupBy.mockResolvedValue([
      { currentStatus: 'ANSWERED', _count: { _all: 1 } },
    ]);
    mockAuthors(prisma, false);
    runTransaction(prisma, { notification: prisma.notification, outboxEvent: prisma.outboxEvent });
    const factory = buildFactory(prisma);

    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('respeita RESPONSE_NOTIFICATIONS_ENABLED=false (fail closed)', async () => {
    const prisma = buildPrisma();
    const disabled = {
      ...config,
      RESPONSE_NOTIFICATIONS_ENABLED: false,
    } as unknown as WorkerConfig;
    const factory = buildFactory(prisma, disabled);
    await factory.processResponseAnalysis('30000000-0000-4000-8000-000000000001', 'job-1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
