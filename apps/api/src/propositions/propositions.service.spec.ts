import type { PrismaService } from '../database/prisma.service';
import type { DeadlinesService } from '../deadlines/deadlines.service';
import { PropositionsService } from './propositions.service';

describe('PropositionsService', () => {
  const dto = {
    type: 'REQUEST' as const,
    number: 20,
    year: 2026,
    protocolDate: '2026-08-01',
    subject: 'Requerimento com coautoria',
    authors: [
      { councilorId: '10000000-0000-4000-8000-000000000001', role: 'PRIMARY' as const },
      { councilorId: '10000000-0000-4000-8000-000000000002', role: 'COAUTHOR' as const },
      { councilorId: '10000000-0000-4000-8000-000000000003', role: 'COAUTHOR' as const },
    ],
    documents: [
      {
        documentId: '20000000-0000-4000-8000-000000000001',
        role: 'PRIMARY' as const,
        sortOrder: 0,
      },
    ],
  };

  it('cria uma única Proposition com três vínculos de autoria e sem copiar o arquivo', async () => {
    const create = jest.fn().mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      ...dto,
      authors: dto.authors,
      deadline: {
        id: '40000000-0000-4000-8000-000000000001',
        originalDueDate: new Date('2026-08-17'),
        currentDueDate: new Date('2026-08-17'),
      },
    });
    const transaction = {
      proposition: { create },
      document: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
      outboxEvent: { createMany: jest.fn() },
    };
    const prisma = {
      councilor: { count: jest.fn().mockResolvedValue(3) },
      document: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: dto.documents[0]!.documentId,
            securityStatus: 'CLEAN',
            processingStatus: 'COMPLETED',
            propositionLinks: [],
            responseLinks: [],
          },
        ]),
      },
      $transaction: (operation: (value: typeof transaction) => unknown) => operation(transaction),
    } as unknown as PrismaService;
    const deadlines = { prepare: jest.fn().mockResolvedValue({}) } as unknown as DeadlinesService;
    const service = new PropositionsService(prisma, deadlines);

    await service.create(dto, '50000000-0000-4000-8000-000000000001');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data.authors.create).toHaveLength(3);
    expect(transaction.document.updateMany).toHaveBeenCalledTimes(1);
  });

  it('bloqueia documento INFECTED antes do vínculo operacional', async () => {
    const prisma = {
      councilor: { count: jest.fn().mockResolvedValue(3) },
      document: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: dto.documents[0]!.documentId,
            securityStatus: 'INFECTED',
            processingStatus: 'NEEDS_REVIEW',
            propositionLinks: [],
            responseLinks: [],
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new PropositionsService(prisma, {
      prepare: jest.fn(),
    } as unknown as DeadlinesService);
    await expect(service.create(dto, '50000000-0000-4000-8000-000000000001')).rejects.toThrow(
      'Somente documentos concluídos',
    );
  });

  it('mantém na timeline revisões que moveram a resposta para dentro ou para fora da proposição', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      proposition: {
        findUnique: jest.fn().mockResolvedValue({
          id: '30000000-0000-4000-8000-000000000001',
          protocolDate: null,
          createdAt: new Date('2026-08-01T12:00:00Z'),
          deadline: null,
          responses: [],
        }),
      },
      responseAssociationRevision: { findMany },
    } as unknown as PrismaService;
    const service = new PropositionsService(prisma, {} as DeadlinesService);

    await service.get('30000000-0000-4000-8000-000000000001');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { previousPropositionId: '30000000-0000-4000-8000-000000000001' },
          { newPropositionId: '30000000-0000-4000-8000-000000000001' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  });
});
