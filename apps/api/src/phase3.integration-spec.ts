import { createHash, randomUUID } from 'node:crypto';
import {
  DocumentAttemptStatus,
  DocumentProcessingTrigger,
  DocumentSecurityStatus,
  DocumentTextSource,
  OcrStatus,
  PrismaClient,
  ProcessingStatus,
  ResponseStatus,
  TextExtractionStatus,
  UserStatus,
} from '@fiscaliza/database';
import type { Prisma } from '@fiscaliza/database';
import { AssociationsService } from './associations/associations.service';
import type { PrismaService } from './database/prisma.service';
import { DeadlinesService } from './deadlines/deadlines.service';
import { PropositionsService } from './propositions/propositions.service';

describe('Phase 3 with PostgreSQL', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const actorId = randomUUID();
  const councilorIds = [randomUUID(), randomUUID(), randomUUID()];
  const documentIds: string[] = [];
  const propositionIds: string[] = [];
  const responseIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: actorId,
        email: `phase3-${suffix}@example.invalid`,
        name: 'Integração Fase 3',
        passwordHash: 'not-a-real-credential',
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.councilor.createMany({
      data: councilorIds.map((id, index) => ({
        id,
        displayName: `Vereador ${index + 1} ${suffix}`,
      })),
    });
  });

  afterAll(async () => {
    await prisma.response.deleteMany({ where: { id: { in: responseIds } } });
    await prisma.proposition.deleteMany({ where: { id: { in: propositionIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.councilor.deleteMany({ where: { id: { in: councilorIds } } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('persiste coautoria, vínculo sem cópia e snapshot de configuração', async () => {
    const documentA = await createDocument('proposition-a.pdf', 'Requerimento 20/2198');
    const documentB = await createDocument('proposition-b.pdf', 'Requerimento 21/2198');
    const prismaService = prisma as unknown as PrismaService;
    const deadlines = new DeadlinesService(prismaService);
    const propositions = new PropositionsService(prismaService, deadlines);
    const setting = await prisma.systemSetting.findUniqueOrThrow({
      where: { key: 'deadlines.policy.REQUEST' },
    });
    const originalValue = setting.value;
    const originalVersion = setting.version;
    try {
      const propositionA = await propositions.create(propositionDto(20, documentA.id), actorId);
      propositionIds.push(propositionA.id);
      expect(propositionA.authors).toHaveLength(3);
      expect(propositionA.deadline?.configurationSnapshot).toMatchObject({
        settingVersion: originalVersion,
        policy: { initialResponseDays: 15 },
      });
      const storedDocument = await prisma.document.findUniqueOrThrow({
        where: { id: documentA.id },
      });
      expect(storedDocument.storageKey).toBe(documentA.storageKey);
      expect(await prisma.propositionDocument.count({ where: { documentId: documentA.id } })).toBe(
        1,
      );

      await prisma.systemSetting.update({
        where: { id: setting.id },
        data: {
          value: { ...(originalValue as object), initialResponseDays: 20 },
          version: { increment: 1 },
        },
      });
      const propositionB = await propositions.create(propositionDto(21, documentB.id), actorId);
      propositionIds.push(propositionB.id);
      expect(propositionA.deadline?.originalDueDate.toISOString().slice(0, 10)).toBe('2026-08-18');
      expect(propositionB.deadline?.originalDueDate.toISOString().slice(0, 10)).toBe('2026-08-24');
    } finally {
      await prisma.systemSetting.update({
        where: { id: setting.id },
        data: { value: originalValue as Prisma.InputJsonValue, version: originalVersion },
      });
    }
  });

  it('associa referência explícita ao tipo correto e persiste sinais explicáveis', async () => {
    const request10 = await createCandidate('REQUEST', 10);
    const request11 = await createCandidate('REQUEST', 11);
    const indication10 = await createCandidate('INDICATION', 10);
    propositionIds.push(request10.id, request11.id, indication10.id);
    const document = await createDocument(
      'response.pdf',
      'Em resposta ao Requerimento nº 10/2198, encaminhamos as informações solicitadas.',
    );
    const response = await prisma.response.create({
      data: {
        type: 'INITIAL',
        protocolDate: new Date('2026-08-20T00:00:00Z'),
        status: ResponseStatus.INGESTED,
        documents: { create: { documentId: document.id, role: 'PRIMARY' } },
      },
    });
    responseIds.push(response.id);
    const associations = new AssociationsService(prisma as unknown as PrismaService);
    const evaluation = await associations.evaluate(response.id);
    const updated = await prisma.response.findUniqueOrThrow({ where: { id: response.id } });
    expect(updated.propositionId).toBe(request10.id);
    expect(evaluation.candidates[0]?.propositionId).toBe(request10.id);
    expect(evaluation.candidates[0]?.signalScores).toMatchObject({
      explicitReference: 1,
      type: 1,
      number: 1,
      year: 1,
    });
  });

  function propositionDto(number: number, documentId: string) {
    return {
      type: 'REQUEST' as const,
      number,
      year: 2198,
      protocolDate: '2026-08-03',
      subject: `Proposição de integração ${number}`,
      authors: councilorIds.map((councilorId, index) => ({
        councilorId,
        role: index === 0 ? ('PRIMARY' as const) : ('COAUTHOR' as const),
      })),
      documents: [{ documentId, role: 'PRIMARY' as const, sortOrder: 0 }],
    };
  }

  async function createCandidate(type: 'REQUEST' | 'INDICATION', number: number) {
    return prisma.proposition.create({
      data: {
        type,
        number,
        year: 2198,
        protocolDate: new Date('2026-08-01T00:00:00Z'),
        subject: `${type} ${number}`,
        status: 'AWAITING_RESPONSE',
        authors: { create: { councilorId: councilorIds[0]!, role: 'PRIMARY' } },
      },
    });
  }

  async function createDocument(name: string, text: string) {
    const id = randomUUID();
    documentIds.push(id);
    const attemptId = randomUUID();
    const storageKey = `documents/2198/${id}/original.pdf`;
    return prisma.document.create({
      data: {
        id,
        originalName: name,
        mimeType: 'application/pdf',
        storageKey,
        sha256: createHash('sha256').update(`${suffix}-${id}`).digest('hex'),
        sizeBytes: 1000,
        pageCount: 1,
        processingAttempt: 1,
        processingStatus: ProcessingStatus.COMPLETED,
        securityStatus: DocumentSecurityStatus.CLEAN,
        textExtractionStatus: TextExtractionStatus.COMPLETED,
        ocrStatus: OcrStatus.NOT_REQUIRED,
        processingAttempts: {
          create: {
            id: attemptId,
            attempt: 1,
            trigger: DocumentProcessingTrigger.UPLOAD,
            status: DocumentAttemptStatus.COMPLETED,
          },
        },
        pages: {
          create: {
            processingAttemptId: attemptId,
            pageNumber: 1,
            extractedText: text,
            effectiveText: text,
            effectiveTextSource: DocumentTextSource.EXTRACTED,
            characterCount: text.length,
          },
        },
      },
      select: { id: true, storageKey: true },
    });
  }
});
