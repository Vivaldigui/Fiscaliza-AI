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
import { EMBEDDING_VERSION } from '@fiscaliza/ai';
import type { WorkerConfig } from '../config';
import { AuthorizedRetriever } from './retrieval';

const config = {
  CONVERSATION_RAG_TOP_K: 8,
  CONVERSATION_MAX_CONTEXT_CHARS: 60_000,
} as unknown as WorkerConfig;

const DIMENSION = 1536;

/**
 * 1536-dimension spike vector for deterministic ranking. Prisma serializes a
 * whole-array parameter as a single PostgreSQL type, so every component is a
 * float: all-integer arrays bind as `bigint[]` (which `vector` cannot cast
 * from) and int/float mixes fail to serialize. Real embedding providers emit
 * floats, so this mirrors production input.
 */
function unitVector(component: number): number[] {
  const vector = new Array<number>(DIMENSION).fill(0.25);
  vector[component] ??= 0.25;
  vector[component] = 1.5;
  return vector;
}

describe('AuthorizedRetriever com PostgreSQL/pgvector', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const propositionIds: string[] = [];
  const documentIds: string[] = [];
  const responseIds: string[] = [];
  let scenarioYear = 2298;
  let retriever: AuthorizedRetriever | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    retriever = new AuthorizedRetriever(
      prisma,
      {
        name: 'spec-embedding',
        model: 'never-used',
        dimension: DIMENSION,
        embed: () => Promise.reject(new Error('não deve chamar o provider nesta spec')),
      },
      config,
    );
  });

  afterAll(async () => {
    await prisma.response.deleteMany({ where: { id: { in: responseIds } } });
    await prisma.proposition.deleteMany({ where: { id: { in: propositionIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.$disconnect();
  });

  it('não retorna chunk fora do escopo autorizado mesmo quando ele é o mais similar (mandatory)', async () => {
    // P1 authorizes D1 only. D2 belongs to another proposition and has the
    // exactly-most-similar embedding to the query. A global-then-filter search
    // would return D2 first; the SQL-scoped search must never see it.
    const {
      documentId: d1,
      attemptId: a1,
      pageId: p1,
    } = await createPageFixture('Documento 1 licitado.');
    const {
      documentId: d2,
      attemptId: a2,
      pageId: p2,
    } = await createPageFixture('Documento 2 proibido para este vereador.');
    await createIndexedChunk(d1, a1, p1, 1, 1, 'Documento 1 licitado.', unitVector(1));
    await createIndexedChunk(
      d2,
      a2,
      p2,
      1,
      1,
      'Documento 2 proibido para este vereador.',
      unitVector(0),
    );
    await createProposition([d1]);
    await createProposition([d2]);

    const pages = await retriever!.retrieveTopPages(unitVector(0), [d1]);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.documentId).toBe(d1);
      expect(page.documentId).not.toBe(d2);
      expect(page.pageId).not.toBe(p2);
    }
  });

  it('autoriza somente documentos vinculados à proposição (inclui respostas, exclui outras)', async () => {
    const {
      documentId: d1,
      attemptId: a1,
      pageId: p1,
    } = await createPageFixture('Requerimento autorizado.');
    const { documentId: d3 } = await createPageFixture('Resposta oficial.');
    await createIndexedChunk(d1, a1, p1, 1, 1, 'Requerimento autorizado.', unitVector(2));
    const proposition = await createProposition([d1]);
    const response = await prisma.response.create({
      data: {
        propositionId: proposition.id,
        type: 'INITIAL',
        status: ResponseStatus.ASSOCIATED,
        protocolDate: new Date('2298-01-10T00:00:00Z'),
        documents: { create: { documentId: d3, role: 'PRIMARY' } },
      },
    });
    responseIds.push(response.id);

    const authorized = await retriever!.authorizedDocumentIds(proposition.id);
    expect(authorized).toContain(d1);
    expect(authorized).toContain(d3);
    // Any document that is neither proposition-linked nor response-linked to
    // this proposition — nor one of the two we deliberately authorized — must
    // stay out of the allowlist, even if it exists in the tenant.
    const others = await prisma.document.findMany({
      where: {
        id: { notIn: [d1, d3] },
        propositionLinks: { none: { propositionId: proposition.id } },
      },
      select: { id: true },
    });
    for (const { id } of others) expect(authorized).not.toContain(id);
  });

  it('filtra para a tentativa de processamento corrente do documento', async () => {
    const document = await createPageFixture('Texto versão 1.');
    const { attemptId: attempt2, pageId: page2 } = await reprocessFixture(
      document.documentId,
      'Texto versão 2 revisado.',
    );
    // Old-attempt chunk is the most similar to the query; it must be ignored
    // because the current attempt is the new one.
    await createIndexedChunk(
      document.documentId,
      document.attemptId,
      document.pageId,
      1,
      1,
      'Texto versão 1.',
      unitVector(0),
    );
    await createIndexedChunk(
      document.documentId,
      attempt2,
      page2,
      2,
      1,
      'Texto versão 2 revisado.',
      unitVector(5),
    );
    await createProposition([document.documentId]);

    const pages = await retriever!.retrieveTopPages(unitVector(0), [document.documentId]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageId).toBe(page2);
  });

  it('ignora chunks de versão de embeddings antiga', async () => {
    const { documentId, attemptId, pageId } = await createPageFixture('Conteúdo corrente.');
    await createIndexedChunk(
      documentId,
      attemptId,
      pageId,
      1,
      1,
      'Conteúdo corrente.',
      unitVector(9),
      'fase-anterior-v0',
    );
    await createIndexedChunk(
      documentId,
      attemptId,
      pageId,
      1,
      2,
      'Conteúdo corrente (reindexado).',
      unitVector(3),
      EMBEDDING_VERSION,
    );
    await createProposition([documentId]);

    const pages = await retriever!.retrieveTopPages(unitVector(3), [documentId]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageId).toBe(pageId);
  });

  it('não executa busca com conjunto autorizado vazio', async () => {
    const pages = await retriever!.retrieveTopPages(unitVector(0), []);
    expect(pages).toHaveLength(0);
  });

  async function createPageFixture(text: string) {
    const id = randomUUID();
    documentIds.push(id);
    const attemptId = randomUUID();
    const document = await prisma.document.create({
      data: {
        id,
        originalName: `documento-${id}.pdf`,
        mimeType: 'application/pdf',
        storageKey: `documents/${scenarioYear}/${id}/original.pdf`,
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
    return { documentId: document.id, attemptId, pageId: document.pages[0]!.id };
  }

  async function reprocessFixture(documentId: string, text: string) {
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
    const page = await prisma.documentPage.create({
      data: {
        documentId,
        processingAttemptId: attemptId,
        pageNumber: 2,
        extractedText: text,
        effectiveText: text,
        effectiveTextSource: DocumentTextSource.EXTRACTED,
        characterCount: text.length,
      },
    });
    await prisma.document.update({ where: { id: documentId }, data: { processingAttempt: 2 } });
    return { attemptId, pageId: page.id };
  }

  async function createIndexedChunk(
    documentId: string,
    attemptId: string,
    pageId: string,
    pageNumber: number,
    sequence: number,
    content: string,
    embedding: number[],
    embeddingVersion: string = EMBEDDING_VERSION,
  ) {
    const chunk = await prisma.documentChunk.create({
      data: {
        documentId,
        processingAttemptId: attemptId,
        pageId,
        pageNumber,
        sequence,
        content,
        contentHash: createHash('sha256').update(`${suffix}-${content}`).digest('hex'),
        embeddingHash: createHash('sha256').update(content).digest('hex'),
        embeddingProvider: 'fake',
        embeddingModel: 'fake-embedding-v1',
        embeddingVersion,
      },
      select: { id: true },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "document_chunks" SET "embedding" = ARRAY[${embedding
        .map((value) => value.toFixed(6))
        .join(',')}]::vector WHERE "id" = '${chunk.id}'`,
    );
    return chunk.id;
  }

  async function createProposition(linkedDocumentIds: string[]) {
    scenarioYear += 1;
    const proposition = await prisma.proposition.create({
      data: {
        type: PropositionType.REQUEST,
        number: ((scenarioYear * 37 + randomUUID().length * scenarioYear * 7) % 99_000) + 1,
        year: scenarioYear,
        protocolDate: new Date('2298-01-01T00:00:00Z'),
        subject: `Requerimento de integração ${suffix} ${scenarioYear}`,
        status: 'AWAITING_RESPONSE',
        documents: {
          create: linkedDocumentIds.map((documentId) => ({ documentId, role: 'PRIMARY' })),
        },
      },
    });
    propositionIds.push(proposition.id);
    return proposition;
  }
});
