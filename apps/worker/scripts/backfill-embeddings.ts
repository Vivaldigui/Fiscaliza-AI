/**
 * Backfill controlado de embeddings (Fase 5A / ADR-002).
 *
 * Enfileira um job de indexação por documento concluído cuja tentativa corrente
 * ainda tenha ao menos um chunk sem o hash da configuração vigente
 * (provider/model/dimension/version). Não toca em historico: documentos em
 * NEEDS_REVIEW/FAILED ou com tentativa corrente incompleta ficam de fora.
 *
 * Uso:
 *   pnpm --filter @fiscaliza/worker exec tsx scripts/backfill-embeddings.ts [--dry-run]
 *
 * O job é idempotente (`embeddingsJobId` determinístico + skip por
 * `embedding_hash`), então reexecutar o backfill é seguro.
 */
import { EMBEDDING_VERSION } from '@fiscaliza/ai';
import { Prisma, PrismaClient, ProcessingStatus } from '@fiscaliza/database';
import Redis from 'ioredis';
import { loadConfig } from '../src/config';
import { EMBEDDINGS_JOB, embeddingsJobId } from '../src/embeddings/embeddings-queue';
import { createEmbeddingsQueue } from '../src/outbox-dispatcher';

interface DocumentToIndex {
  documentId: string;
  attempt: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();
  const prisma = new PrismaClient();
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = createEmbeddingsQueue(redis);
  await Promise.all([prisma.$connect(), queue.waitUntilReady()]);

  if (!config.EMBEDDINGS_ENABLED) {
    console.warn('EMBEDDINGS_ENABLED=false — o worker ignorará os jobs enfileirados.');
  }

  const rows = await prisma.$queryRaw<DocumentToIndex[]>(Prisma.sql`
    SELECT d.id AS "documentId", d.processing_attempt AS attempt
    FROM "public"."documents" d
    JOIN "public"."document_processing_attempts" pa
      ON pa.document_id = d.id AND pa.attempt = d.processing_attempt
     AND pa.status = 'COMPLETED'::"DocumentAttemptStatus"
    JOIN "public"."document_chunks" c ON c.processing_attempt_id = pa.id
    WHERE d.processing_status = ${ProcessingStatus.COMPLETED}::"ProcessingStatus"
      AND (
        c.embedding_hash IS NULL
        OR c.embedding_version IS DISTINCT FROM ${EMBEDDING_VERSION}
        OR c.embedding_provider IS DISTINCT FROM ${config.EMBEDDINGS_PROVIDER}
        OR c.embedding_model IS DISTINCT FROM ${config.EMBEDDINGS_MODEL}
      )
    GROUP BY d.id, d.processing_attempt
    ORDER BY d.created_at ASC
  `);

  try {
    if (rows.length === 0) {
      console.log('Nenhum documento precisa de (re)indexação.');
      return;
    }
    for (const row of rows) {
      const payload = {
        outboxEventId: 'backfill',
        documentId: row.documentId,
        attempt: row.attempt,
        status: ProcessingStatus.COMPLETED,
      } as const;
      if (dryRun) {
        console.log(`[dry-run] enfileiraria ${embeddingsJobId(payload)}`);
        continue;
      }
      await queue.add(EMBEDDINGS_JOB, payload, {
        jobId: embeddingsJobId(payload),
        attempts: config.EMBEDDINGS_QUEUE_ATTEMPTS,
        backoff: { type: 'exponential', delay: config.EMBEDDINGS_QUEUE_BACKOFF_MS },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 7 * 86_400, count: 1_000 },
      });
    }
    console.log(`Enfileirados ${rows.length} documentos para indexação.`);
  } finally {
    await Promise.allSettled([queue.close(), redis.quit(), prisma.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : 'Falha desconhecida no backfill.',
  );
  process.exitCode = 1;
});
