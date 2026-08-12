import {
  computeEmbeddingHash,
  createEmbeddingProvider,
  EMBEDDING_VERSION,
  embedInBatches,
  type EmbeddingProvider,
} from '@fiscaliza/ai';
import {
  DocumentAttemptStatus,
  ProcessingStatus,
  Prisma,
  type PrismaClient,
} from '@fiscaliza/database';
import { createHash } from 'node:crypto';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';

interface PendingChunk {
  id: string;
  content: string;
  embeddingHash: string | null;
}

/**
 * Indexes the chunks of one document processing attempt, idempotently.
 *
 * Policy (ADR-002):
 * - Only the document's *current* attempt is indexed; an attempt that is no
 *   longer current (a newer reprocessing already finished) is left untouched,
 *   so reprocessing never mutates historical evidence.
 * - Only COMPLETED (no review pending) documents/attempts are indexed.
 * - A chunk whose `embedding_hash` already matches the current
 *   provider+model+dimension+version+content is skipped (crash-safe re-run of
 *   the same logical job is a no-op).
 * - Reprocessing a document writes a NEW attempt and NEW chunks; old chunk rows
 *   keep their old hash/version and are naturally excluded from retrieval by the
 *   `pa.attempt = d.processing_attempt` filter.
 *
 * The `vector` column is opaque to Prisma, so vectors and the metadata that
 * accompanies them are persisted with raw SQL inside one transaction with the
 * usage row.
 */
export class EmbeddingsIndexer {
  private readonly provider: EmbeddingProvider;
  private readonly version = EMBEDDING_VERSION;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {
    this.provider = createEmbeddingProvider({
      provider: config.EMBEDDINGS_PROVIDER,
      model: config.EMBEDDINGS_MODEL,
      dimension: config.EMBEDDINGS_DIMENSION,
      timeoutMs: config.EMBEDDINGS_TIMEOUT_MS,
      ...(config.EMBEDDINGS_API_KEY ? { apiKey: config.EMBEDDINGS_API_KEY } : {}),
    });
  }

  async process(documentId: string, attempt: number, jobId: string): Promise<void> {
    if (!this.config.EMBEDDINGS_ENABLED) {
      this.logger.warn('Indexação por embeddings desabilitada; job ignorado.', {
        documentId,
        attempt,
        jobId,
        stage: 'embeddings',
      });
      return;
    }

    const attemptRecord = await this.prisma.documentProcessingAttempt.findUnique({
      where: { documentId_attempt: { documentId, attempt } },
      include: {
        document: { select: { processingAttempt: true, processingStatus: true } },
      },
    });
    if (!attemptRecord) {
      this.logger.warn('Tentativa documental não encontrada; job obsoleto.', {
        documentId,
        attempt,
        jobId,
        stage: 'embeddings',
      });
      return;
    }
    if (attemptRecord.document.processingAttempt !== attempt) {
      this.logger.info('Tentativa não é mais a corrente do documento; nada a indexar.', {
        documentId,
        attempt,
        currentAttempt: attemptRecord.document.processingAttempt,
        jobId,
        stage: 'embeddings',
      });
      return;
    }
    if (
      attemptRecord.status !== DocumentAttemptStatus.COMPLETED ||
      attemptRecord.document.processingStatus !== ProcessingStatus.COMPLETED
    ) {
      this.logger.info('Documento com revisão pendente; fora do escopo da indexação.', {
        documentId,
        attempt,
        attemptStatus: attemptRecord.status,
        processingStatus: attemptRecord.document.processingStatus,
        jobId,
        stage: 'embeddings',
      });
      return;
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: { processingAttemptId: attemptRecord.id },
      orderBy: [{ pageNumber: 'asc' }, { sequence: 'asc' }],
      select: { id: true, content: true, embeddingHash: true },
    });
    if (chunks.length === 0) {
      this.logger.warn('Documento sem chunks na tentativa corrente; nada a indexar.', {
        documentId,
        attempt,
        jobId,
        stage: 'embeddings',
      });
      return;
    }

    const pending: PendingChunk[] = [];
    for (const chunk of chunks) {
      const embeddingHash = this.hashFor(chunk.content);
      if (chunk.embeddingHash === embeddingHash) continue;
      pending.push({ id: chunk.id, content: chunk.content, embeddingHash });
    }

    if (pending.length === 0) {
      this.logger.info('Documento já indexado com a configuração atual.', {
        documentId,
        attempt,
        chunkCount: chunks.length,
        jobId,
        stage: 'embeddings',
        provider: this.provider.name,
        model: this.provider.model,
        version: this.version,
      });
      return;
    }

    const startedAt = Date.now();
    const result = await embedInBatches(
      this.provider,
      pending.map((chunk) => chunk.content),
      this.config.EMBEDDINGS_BATCH_SIZE,
    );
    if (result.vectors.length !== pending.length) {
      throw new Error(
        `Provider devolveu ${result.vectors.length} vetores para ${pending.length} chunks.`,
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      for (let index = 0; index < pending.length; index += 1) {
        const chunk = pending[index]!;
        const vector = result.vectors[index]!;
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "document_chunks"
          SET
            "embedding" = ${vector}::vector,
            "embedding_provider" = ${this.provider.name},
            "embedding_model" = ${this.provider.model},
            "embedding_version" = ${this.version},
            "embedding_hash" = ${chunk.embeddingHash}
          WHERE "id" = ${chunk.id}::uuid
        `);
      }
      await transaction.aIUsage.create({
        data: {
          analysisId: null,
          provider: this.provider.name,
          model: this.provider.model,
          operation: 'embedding',
          promptVersion: this.version,
          analysisVersion: this.version,
          inputHash: this.jobHash(documentId, attempt),
          inputTokens: result.inputTokens,
          outputTokens: null,
          latencyMs: result.latencyMs,
          cached: false,
        },
      });
    });

    this.logger.info('Indexação por embeddings concluída.', {
      documentId,
      attempt,
      chunkCount: pending.length,
      skipped: chunks.length - pending.length,
      batchCount: result.batchCount,
      inputTokens: result.inputTokens,
      latencyMs: result.latencyMs,
      totalMs: Date.now() - startedAt,
      provider: this.provider.name,
      model: this.provider.model,
      version: this.version,
      jobId,
      stage: 'embeddings',
    });
  }

  private hashFor(content: string): string {
    return computeEmbeddingHash(
      content,
      this.provider.name,
      this.provider.model,
      this.provider.dimension,
      this.version,
    );
  }

  private jobHash(documentId: string, attempt: number): string {
    return createHash('sha256').update(`embed:${documentId}:${attempt}`, 'utf8').digest('hex');
  }
}
