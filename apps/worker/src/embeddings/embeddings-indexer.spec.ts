import { computeEmbeddingHash, EMBEDDING_VERSION } from '@fiscaliza/ai';
import { DocumentAttemptStatus, ProcessingStatus, type PrismaClient } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { EmbeddingsIndexer } from './embeddings-indexer';

const logger = new StructuredLogger('error');

const documentId = '10000000-0000-4000-8000-000000000001';
const attemptRecordId = '20000000-0000-4000-8000-000000000001';
const chunkId = '30000000-0000-4000-8000-000000000001';

const config = {
  EMBEDDINGS_ENABLED: true,
  EMBEDDINGS_PROVIDER: 'fake',
  EMBEDDINGS_MODEL: 'fake-test',
  EMBEDDINGS_DIMENSION: 8,
  EMBEDDINGS_BATCH_SIZE: 4,
} as unknown as WorkerConfig;

const completedAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: attemptRecordId,
  status: DocumentAttemptStatus.COMPLETED,
  document: { processingAttempt: 1, processingStatus: ProcessingStatus.COMPLETED },
  ...overrides,
});

function buildPrisma() {
  return {
    documentProcessingAttempt: { findUnique: jest.fn() },
    documentChunk: { findMany: jest.fn() },
    aIUsage: { create: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
}

type MockPrisma = ReturnType<typeof buildPrisma>;

function runTransaction(
  mock: MockPrisma,
  transaction: { $executeRaw: jest.Mock; aIUsage: { create: jest.Mock } },
) {
  mock.$transaction.mockImplementation(
    (operation: (value: unknown) => unknown) => operation(transaction) as never,
  );
}

function buildIndexer(mock: MockPrisma) {
  return new EmbeddingsIndexer(mock as unknown as PrismaClient, config, logger);
}

/** Same value the indexer computes: hash over content + provider identity. */
const expectedHash = (content: string) =>
  computeEmbeddingHash(content, 'fake', 'fake-test', 8, EMBEDDING_VERSION);

describe('EmbeddingsIndexer', () => {
  it('não faz nenhuma leitura quando a indexação está desabilitada', async () => {
    const mock = buildPrisma();
    const disabled = {
      ...config,
      EMBEDDINGS_ENABLED: false,
    } as unknown as WorkerConfig;
    await new EmbeddingsIndexer(mock as unknown as PrismaClient, disabled, logger).process(
      documentId,
      1,
      'job-disabled',
    );

    expect(mock.documentProcessingAttempt.findUnique).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('ignora job de tentativa inexistente', async () => {
    const mock = buildPrisma();
    mock.documentProcessingAttempt.findUnique.mockResolvedValue(null);
    await buildIndexer(mock).process(documentId, 1, 'job-missing');

    expect(mock.documentChunk.findMany).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('não reindexa tentativa que deixou de ser a corrente do documento', async () => {
    const mock = buildPrisma();
    mock.documentProcessingAttempt.findUnique.mockResolvedValue(
      completedAttempt({
        document: { processingAttempt: 2, processingStatus: ProcessingStatus.COMPLETED },
      }),
    );
    await buildIndexer(mock).process(documentId, 1, 'job-stale');

    expect(mock.documentChunk.findMany).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('não indexa documento com revisão pendente (fail-closed)', async () => {
    const mock = buildPrisma();
    mock.documentProcessingAttempt.findUnique.mockResolvedValue(
      completedAttempt({
        status: DocumentAttemptStatus.COMPLETED,
        document: { processingAttempt: 1, processingStatus: ProcessingStatus.NEEDS_REVIEW },
      }),
    );
    await buildIndexer(mock).process(documentId, 1, 'job-review');

    expect(mock.documentChunk.findMany).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('pula chunks já indexados com o hash corrente (idempotência / reindexação crash-safe)', async () => {
    const mock = buildPrisma();
    mock.documentProcessingAttempt.findUnique.mockResolvedValue(completedAttempt());
    const content = 'Conteúdo já vetorizado.';
    mock.documentChunk.findMany.mockResolvedValue([
      { id: chunkId, content, embeddingHash: expectedHash(content) },
    ]);
    await buildIndexer(mock).process(documentId, 1, 'job-reindex');

    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('indexa apenas os chunks pendentes e registra o uso de IA por job', async () => {
    const mock = buildPrisma();
    mock.documentProcessingAttempt.findUnique.mockResolvedValue(completedAttempt());
    const indexedContent = 'Chunk já indexado.';
    const pendingContent = 'Chunk que precisa de vetor.';
    mock.documentChunk.findMany.mockResolvedValue([
      {
        id: '30000000-0000-4000-8000-000000000001',
        content: indexedContent,
        embeddingHash: expectedHash(indexedContent),
      },
      { id: '30000000-0000-4000-8000-000000000002', content: pendingContent, embeddingHash: null },
    ]);
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      aIUsage: { create: jest.fn().mockResolvedValue({}) },
    };
    runTransaction(mock, transaction);
    await buildIndexer(mock).process(documentId, 1, 'job-pending');

    // Only the chunk without a hash is written; the already-indexed one is skipped.
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const raw = transaction.$executeRaw.mock.calls[0]?.[0];
    // Positional params of the UPDATE: vector, provider, model, version, hash, chunk id.
    expect(String(raw?.values?.[2] ?? '')).toBe('fake-test');
    expect(String(raw?.values?.[4] ?? '')).toBe(expectedHash(pendingContent));
    expect(transaction.aIUsage.create).toHaveBeenCalledTimes(1);
    const usage = transaction.aIUsage.create.mock.calls[0]?.[0]?.data;
    expect(usage.operation).toBe('embedding');
    expect(usage.provider).toBe('fake');
    expect(usage.model).toBe('fake-test');
    expect(usage.analysisId).toBeNull();
    expect(usage.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(usage.cached).toBe(false);
  });
});
