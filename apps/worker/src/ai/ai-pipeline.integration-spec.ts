import { createHash, randomUUID } from 'node:crypto';
import {
  DocumentAttemptStatus,
  DocumentProcessingTrigger,
  DocumentSecurityStatus,
  DocumentTextSource,
  OcrStatus,
  PrismaClient,
  ProcessingStatus,
  PropositionType,
  ResponseStatus,
  TextExtractionStatus,
} from '@fiscaliza/database';
import { FakeLLMProvider } from '@fiscaliza/ai';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { AiAnalysisPipeline } from './ai-pipeline';

const config = {
  AI_PROCESSING_ENABLED: true,
  AI_MAX_PAGES_PER_BATCH: 50,
  AI_MAX_RETRIES: 1,
  AI_MAX_INPUT_CHARS: 60_000,
} as unknown as WorkerConfig;

const FAKE_UUID_1 = '00000000-0000-4000-8000-0000000000f1';

function summaryResponse(status: string) {
  return {
    summary: `Resumo sintético (${status}).`,
    mainFindings: [{ text: 'Achado sintético.', analysisItemIds: [FAKE_UUID_1] }],
    pendingItems: [],
    importantNumbers: [],
    importantDates: [],
    mentionedEntities: [],
  };
}

describe('AiAnalysisPipeline com PostgreSQL', () => {
  const prisma = new PrismaClient();
  const logger = new StructuredLogger('error');
  const suffix = randomUUID();
  const propositionIds: string[] = [];
  const documentIds: string[] = [];
  const responseIds: string[] = [];
  let year = 2298;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.response.deleteMany({ where: { id: { in: responseIds } } });
    await prisma.proposition.deleteMany({ where: { id: { in: propositionIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.$disconnect();
  });

  it('distingue respondido/parcial/não respondido e aponta evidência na página correta', async () => {
    const requirement = await createDocument(
      '1. Qual o número de veículos? 2. Qual o valor gasto em manutenção? 3. Quais empresas realizaram manutenção?',
    );
    const proposition = await createProposition(requirement.id);
    const response = await createResponse(proposition.id, [
      'A frota é composta por 12 veículos.',
      'Em janeiro foram gastos R$ 8.000,00 com manutenção.',
    ]);

    const provider = new FakeLLMProvider();
    provider.queueStructured({
      items: [
        {
          sequence: 1,
          originalText: 'Qual o número de veículos?',
          normalizedQuestion: 'Informar a quantidade de veículos.',
          expectedAnswerType: 'QUANTITY',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.98,
        },
        {
          sequence: 2,
          originalText: 'Qual o valor gasto em manutenção?',
          normalizedQuestion: 'Informar o valor total gasto com manutenção.',
          expectedAnswerType: 'CURRENCY',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.97,
        },
        {
          sequence: 3,
          originalText: 'Quais empresas realizaram manutenção?',
          normalizedQuestion: 'Informar as empresas que realizaram manutenção.',
          expectedAnswerType: 'LIST',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.96,
        },
      ],
    });
    provider.queueStructured(async () => {
      // Extraction has already run and persisted RequestedItems earlier in this
      // same `process()` call, so their real ids can be resolved here.
      const items = await prisma.requestedItem.findMany({
        where: { propositionId: proposition.id, active: true },
        orderBy: { sequence: 'asc' },
      });
      const idBySequence = new Map(items.map((item) => [item.sequence, item.id]));
      return {
        items: [
          {
            requestedItemId: idBySequence.get(1),
            status: 'ANSWERED',
            explanation: 'A resposta informa 12 veículos.',
            confidence: 0.97,
            evidences: [
              {
                documentPageId: response.pageIds[0],
                pageNumber: 1,
                excerpt: 'A frota é composta por 12 veículos.',
                reason: 'Apresenta a quantidade solicitada.',
              },
            ],
          },
          {
            requestedItemId: idBySequence.get(2),
            status: 'PARTIALLY_ANSWERED',
            explanation: 'Informa valor de janeiro, mas não o total do período.',
            confidence: 0.9,
            evidences: [
              {
                documentPageId: response.pageIds[1],
                pageNumber: 2,
                excerpt: 'Em janeiro foram gastos R$ 8.000,00 com manutenção.',
                reason: 'Valor parcial, falta totalização.',
              },
            ],
          },
          {
            requestedItemId: idBySequence.get(3),
            status: 'NOT_ANSWERED',
            explanation: 'A resposta não identifica as empresas.',
            confidence: 0.95,
            evidences: [],
          },
        ],
      };
    });
    provider.queueStructured(summaryResponse('primeira análise'));

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis.id, 'test-job-1');

    const completed = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis.id },
      include: { items: { include: { evidences: true, requestedItem: true } } },
    });
    expect(completed.status).toBe('COMPLETED');
    const bySequence = new Map(completed.items.map((item) => [item.requestedItem?.sequence, item]));
    expect(bySequence.get(1)?.currentStatus).toBe('ANSWERED');
    expect(bySequence.get(1)?.evidences[0]?.documentPageId).toBe(response.pageIds[0]);
    expect(bySequence.get(2)?.currentStatus).toBe('PARTIALLY_ANSWERED');
    expect(bySequence.get(2)?.evidences[0]?.documentPageId).toBe(response.pageIds[1]);
    expect(bySequence.get(3)?.currentStatus).toBe('NOT_ANSWERED');
    expect(bySequence.get(3)?.evidences.length).toBe(0);
  });

  it('não persiste evidência com documentPageId inventado e marca item para revisão humana', async () => {
    const requirement = await createDocument('1. Qual o valor gasto com manutenção?');
    const proposition = await createProposition(requirement.id);
    const response = await createResponse(proposition.id, [
      'Foram realizadas diversas manutenções.',
    ]);

    const provider = new FakeLLMProvider();
    provider.queueStructured({
      items: [
        {
          sequence: 1,
          originalText: 'Qual o valor gasto com manutenção?',
          normalizedQuestion: 'Informar o valor gasto com manutenção.',
          expectedAnswerType: 'CURRENCY',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.9,
        },
      ],
    });
    provider.queueStructured({
      items: [
        {
          requestedItemId: '00000000-0000-4000-8000-000000000000',
          status: 'ANSWERED',
          explanation: 'Valor localizado.',
          confidence: 0.9,
          evidences: [
            {
              documentPageId: '00000000-0000-4000-8000-00000000dead',
              pageNumber: 1,
              excerpt: 'Foram gastos R$ 1.000,00.',
              reason: 'Evidência inventada.',
            },
          ],
        },
      ],
    });
    provider.queueStructured(summaryResponse('evidência inventada'));

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis.id, 'test-job-2');

    const completed = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis.id },
      include: { items: { include: { evidences: true } } },
    });
    expect(completed.items[0]?.currentStatus).toBe('NEEDS_HUMAN_REVIEW');
    expect(completed.items[0]?.evidences.length).toBe(0);
    expect(completed.status).toBe('NEEDS_HUMAN_REVIEW');
    void response;
  });

  it('reaproveita a extração já concluída para a mesma versão documental (idempotência)', async () => {
    const requirement = await createDocument('1. Qual o número de veículos?');
    const proposition = await createProposition(requirement.id);

    const provider = new FakeLLMProvider();
    provider.queueStructured({
      items: [
        {
          sequence: 1,
          originalText: 'Qual o número de veículos?',
          normalizedQuestion: 'Informar a quantidade de veículos.',
          expectedAnswerType: 'QUANTITY',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.9,
        },
      ],
    });
    provider.queueStructured(summaryResponse('primeira execução'));
    provider.queueStructured(summaryResponse('segunda execução'));

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis1 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis1.id, 'test-job-3a');
    const itemsAfterFirst = await prisma.requestedItem.findMany({
      where: { propositionId: proposition.id, active: true },
    });
    expect(itemsAfterFirst).toHaveLength(1);

    const analysis2 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis2.id, 'test-job-3b');
    const itemsAfterSecond = await prisma.requestedItem.findMany({
      where: { propositionId: proposition.id, active: true },
    });
    expect(itemsAfterSecond).toHaveLength(1);
    expect(itemsAfterSecond[0]?.id).toBe(itemsAfterFirst[0]?.id);
    // 1 extraction call (shared) + 1 executive-summary call per analysis run = 3.
    expect(provider.structuredCallCount).toBe(3);
  });

  it('esgota tentativas com JSON inválido e marca a análise como FAILED sem persistir itens', async () => {
    const requirement = await createDocument('1. Qual o número de veículos?');
    const proposition = await createProposition(requirement.id);

    const provider = new FakeLLMProvider();
    provider.queueStructured({ items: 'não é um array' });
    provider.queueStructured({ items: [] });

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis.id, 'test-job-4');

    const failed = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis.id },
      include: { items: true },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.items).toHaveLength(0);
  });

  it('resposta complementar gera nova análise cumulativa sem apagar a anterior', async () => {
    const requirement = await createDocument('1. Quais empresas realizaram manutenção?');
    const proposition = await createProposition(requirement.id);
    await createResponse(proposition.id, ['Foram realizadas diversas manutenções no período.']);

    const provider = new FakeLLMProvider();
    provider.queueStructured({
      items: [
        {
          sequence: 1,
          originalText: 'Quais empresas realizaram manutenção?',
          normalizedQuestion: 'Informar as empresas que realizaram manutenção.',
          expectedAnswerType: 'LIST',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.95,
        },
      ],
    });
    provider.queueStructured(async () => ({
      items: [
        {
          requestedItemId: await onlyActiveItemId(proposition.id),
          status: 'NOT_ANSWERED',
          explanation: 'A resposta não identifica as empresas.',
          confidence: 0.93,
          evidences: [],
        },
      ],
    }));
    provider.queueStructured(summaryResponse('inicial'));

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis1 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis1.id, 'complementary-1');
    const afterFirst = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis1.id },
      include: { items: { include: { evidences: true } } },
    });
    expect(afterFirst.items[0]?.currentStatus).toBe('NOT_ANSWERED');

    const complementary = await createResponse(
      proposition.id,
      ['A empresa XYZ Manutenções Ltda. realizou os serviços.'],
      'COMPLEMENTARY',
    );
    provider.queueStructured({
      items: [
        {
          requestedItemId: await onlyActiveItemId(proposition.id),
          status: 'ANSWERED',
          explanation: 'A resposta complementar identifica a empresa XYZ Manutenções Ltda.',
          confidence: 0.96,
          evidences: [
            {
              documentPageId: complementary.pageIds[0],
              pageNumber: 1,
              excerpt: 'A empresa XYZ Manutenções Ltda. realizou os serviços.',
              reason: 'Nome da empresa presente na resposta complementar.',
            },
          ],
        },
      ],
    });
    provider.queueStructured(summaryResponse('após complementação'));

    const analysis2 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis2.id, 'complementary-2');

    const stillFirst = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis1.id },
      include: { items: { include: { evidences: true } } },
    });
    expect(stillFirst.items[0]?.currentStatus).toBe('NOT_ANSWERED');
    const second = await prisma.analysis.findUniqueOrThrow({
      where: { id: analysis2.id },
      include: { items: { include: { evidences: true } } },
    });
    expect(second.items[0]?.currentStatus).toBe('ANSWERED');
    expect(second.items[0]?.evidences[0]?.documentPageId).toBe(complementary.pageIds[0]);
  });

  it('reprocessamento documental cria nova tentativa sem alterar evidência da análise histórica', async () => {
    const requirement = await createDocument('1. Qual o número de veículos?');
    const proposition = await createProposition(requirement.id);
    const response = await createResponse(proposition.id, ['A frota é composta por 12 veículos.']);

    const provider = new FakeLLMProvider();
    provider.queueStructured({
      items: [
        {
          sequence: 1,
          originalText: 'Qual o número de veículos?',
          normalizedQuestion: 'Informar a quantidade de veículos.',
          expectedAnswerType: 'QUANTITY',
          sourceDocumentPageId: requirement.pageIds[0],
          sourcePageNumber: 1,
          confidence: 0.95,
        },
      ],
    });
    provider.queueStructured(async () => ({
      items: [
        {
          requestedItemId: await onlyActiveItemId(proposition.id),
          status: 'ANSWERED',
          explanation: 'A frota tem 12 veículos.',
          confidence: 0.97,
          evidences: [
            {
              documentPageId: response.pageIds[0],
              pageNumber: 1,
              excerpt: 'A frota é composta por 12 veículos.',
              reason: 'Quantidade presente.',
            },
          ],
        },
      ],
    }));
    provider.queueStructured(summaryResponse('tentativa 1'));

    const pipeline = new AiAnalysisPipeline(prisma, provider, config, logger);
    const analysis1 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis1.id, 'versioning-1');
    const firstEvidencePageId = (
      await prisma.evidence.findFirstOrThrow({ where: { analysisId: analysis1.id } })
    ).documentPageId;
    expect(firstEvidencePageId).toBe(response.pageIds[0]);

    const reprocessed = await reprocessDocument(response.documentId, [
      'A frota é composta por 12 veículos (revisão de OCR).',
    ]);

    provider.queueStructured({
      items: [
        {
          requestedItemId: await onlyActiveItemId(proposition.id),
          status: 'ANSWERED',
          explanation: 'A frota tem 12 veículos (nova versão documental).',
          confidence: 0.97,
          evidences: [
            {
              documentPageId: reprocessed.pageIds[0],
              pageNumber: 1,
              excerpt: 'A frota é composta por 12 veículos (revisão de OCR).',
              reason: 'Quantidade presente na nova tentativa.',
            },
          ],
        },
      ],
    });
    provider.queueStructured(summaryResponse('tentativa 2'));

    const analysis2 = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis2.id, 'versioning-2');

    const historicalEvidence = await prisma.evidence.findFirstOrThrow({
      where: { analysisId: analysis1.id },
    });
    expect(historicalEvidence.documentPageId).toBe(response.pageIds[0]);
    const newEvidence = await prisma.evidence.findFirstOrThrow({
      where: { analysisId: analysis2.id },
    });
    expect(newEvidence.documentPageId).toBe(reprocessed.pageIds[0]);
    expect(newEvidence.documentPageId).not.toBe(historicalEvidence.documentPageId);
  });

  it('não processa quando AI_PROCESSING_ENABLED está desabilitado (fail closed)', async () => {
    const requirement = await createDocument('1. Qual o número de veículos?');
    const proposition = await createProposition(requirement.id);
    const provider = new FakeLLMProvider();
    const disabledConfig = { ...config, AI_PROCESSING_ENABLED: false } as unknown as WorkerConfig;
    const pipeline = new AiAnalysisPipeline(prisma, provider, disabledConfig, logger);
    const analysis = await createPendingAnalysis(proposition.id, 'REQUEST_RESPONSE');
    await pipeline.process(analysis.id, 'test-job-5');

    const failed = await prisma.analysis.findUniqueOrThrow({ where: { id: analysis.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toContain('AI_PROCESSING_ENABLED');
    expect(provider.structuredCallCount).toBe(0);
  });

  async function createDocument(text: string) {
    const id = randomUUID();
    documentIds.push(id);
    const attemptId = randomUUID();
    const storageKey = `documents/${year}/${id}/original.pdf`;
    const document = await prisma.document.create({
      data: {
        id,
        originalName: `documento-${id}.pdf`,
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
      include: { pages: true },
    });
    return { id: document.id, pageIds: document.pages.map((page) => page.id) };
  }

  async function createResponsePages(text: string[]) {
    const id = randomUUID();
    documentIds.push(id);
    const attemptId = randomUUID();
    const document = await prisma.document.create({
      data: {
        id,
        originalName: `resposta-${id}.pdf`,
        mimeType: 'application/pdf',
        storageKey: `documents/${year}/${id}/original.pdf`,
        sha256: createHash('sha256').update(`${suffix}-r-${id}`).digest('hex'),
        sizeBytes: 1000,
        pageCount: text.length,
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
          create: text.map((pageText, index) => ({
            processingAttemptId: attemptId,
            pageNumber: index + 1,
            extractedText: pageText,
            effectiveText: pageText,
            effectiveTextSource: DocumentTextSource.EXTRACTED,
            characterCount: pageText.length,
          })),
        },
      },
      include: { pages: { orderBy: { pageNumber: 'asc' } } },
    });
    return { id: document.id, pageIds: document.pages.map((page) => page.id) };
  }

  async function createProposition(requirementDocumentId: string) {
    year += 1;
    const proposition = await prisma.proposition.create({
      data: {
        type: PropositionType.REQUEST,
        number: Math.floor(Math.random() * 100_000) + 1,
        year,
        protocolDate: new Date('2298-01-01T00:00:00Z'),
        subject: `Requerimento de integração ${suffix}`,
        status: 'AWAITING_RESPONSE',
        documents: { create: { documentId: requirementDocumentId, role: 'PRIMARY' } },
      },
    });
    propositionIds.push(proposition.id);
    return proposition;
  }

  async function createResponse(
    propositionId: string,
    pagesText: string[],
    type: 'INITIAL' | 'COMPLEMENTARY' = 'INITIAL',
  ) {
    const document = await createResponsePages(pagesText);
    const response = await prisma.response.create({
      data: {
        propositionId,
        type,
        status: ResponseStatus.ASSOCIATED,
        protocolDate: new Date(
          type === 'INITIAL' ? '2298-01-10T00:00:00Z' : '2298-02-10T00:00:00Z',
        ),
        documents: { create: { documentId: document.id, role: 'PRIMARY' } },
      },
    });
    responseIds.push(response.id);
    return { id: response.id, documentId: document.id, pageIds: document.pageIds };
  }

  async function reprocessDocument(documentId: string, pagesText: string[]) {
    const attemptId = randomUUID();
    await prisma.documentProcessingAttempt.create({
      data: {
        id: attemptId,
        documentId,
        attempt: 2,
        trigger: DocumentProcessingTrigger.REPROCESS,
        status: DocumentAttemptStatus.COMPLETED,
      },
    });
    const pages = await Promise.all(
      pagesText.map((text, index) =>
        prisma.documentPage.create({
          data: {
            documentId,
            processingAttemptId: attemptId,
            pageNumber: index + 1,
            extractedText: text,
            effectiveText: text,
            effectiveTextSource: DocumentTextSource.EXTRACTED,
            characterCount: text.length,
          },
        }),
      ),
    );
    await prisma.document.update({ where: { id: documentId }, data: { processingAttempt: 2 } });
    return { pageIds: pages.map((page) => page.id) };
  }

  async function onlyActiveItemId(propositionId: string): Promise<string> {
    const item = await prisma.requestedItem.findFirstOrThrow({
      where: { propositionId, active: true },
    });
    return item.id;
  }

  async function createPendingAnalysis(
    propositionId: string,
    type: 'REQUEST_RESPONSE' | 'INDICATION_RESPONSE',
  ) {
    return prisma.analysis.create({
      data: {
        propositionId,
        type,
        status: 'PENDING',
        provider: 'fake',
        model: 'fake-deterministic-v1',
        promptVersion: 'test',
        analysisVersion: 'test',
        inputHash: createHash('sha256').update(randomUUID()).digest('hex'),
      },
    });
  }
});
