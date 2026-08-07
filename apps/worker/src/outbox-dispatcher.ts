import type { PrismaClient } from '@fiscaliza/database';
import { Prisma } from '@fiscaliza/database';
import {
  DOCUMENT_JOB,
  DOCUMENT_QUEUE,
  documentJobId,
  type DocumentQueuePayload,
} from '@fiscaliza/document-processing';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerConfig } from './config';
import type { StructuredLogger } from './logger';

interface ClaimedOutboxEvent {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

const DOCUMENT_EVENTS = new Set(['DocumentUploaded', 'DocumentReprocessRequested']);

export class OutboxDispatcher {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: Queue<DocumentQueuePayload>,
    private readonly redis: Redis,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.claim();
      for (const event of events) await this.publish(event);
    } catch (error) {
      this.logger.error('Falha no dispatcher outbox.', {
        stage: 'outbox',
        error: error instanceof Error ? error.message : 'erro desconhecido',
      });
    } finally {
      this.running = false;
    }
  }

  private claim(): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(async (transaction) => {
      const events = await transaction.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
        SELECT id, event_type, aggregate_id, payload, attempts
        FROM "outbox_events"
        WHERE available_at <= NOW()
          AND (
            status = 'PENDING'::"OutboxStatus"
            OR (status = 'PROCESSING'::"OutboxStatus" AND updated_at < NOW() - INTERVAL '5 minutes')
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.config.OUTBOX_BATCH_SIZE}
      `);
      if (events.length) {
        await transaction.outboxEvent.updateMany({
          where: { id: { in: events.map(({ id }) => id) } },
          data: { status: 'PROCESSING', attempts: { increment: 1 } },
        });
      }
      return events;
    });
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    try {
      if (DOCUMENT_EVENTS.has(event.event_type)) {
        const payload = parseDocumentPayload(event);
        await this.queue.add(DOCUMENT_JOB, payload, {
          jobId: documentJobId(payload),
          attempts: this.config.DOCUMENT_QUEUE_ATTEMPTS,
          backoff: { type: 'exponential', delay: this.config.DOCUMENT_QUEUE_BACKOFF_MS },
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 7 * 86_400, count: 1_000 },
        });
      } else {
        await this.redis.xadd(
          'fiscaliza:domain-events',
          'MAXLEN',
          '~',
          '10000',
          '*',
          'eventId',
          event.id,
          'eventType',
          event.event_type,
          'aggregateId',
          event.aggregate_id,
          'payload',
          JSON.stringify(event.payload),
        );
      }
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'PROCESSING' },
        data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const attempts = event.attempts + 1;
      const exhausted = attempts >= 10;
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          lastError: error instanceof Error ? error.message : 'Falha desconhecida na publicação.',
          availableAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** attempts)),
        },
      });
      this.logger.error('Falha ao publicar evento outbox.', {
        stage: 'outbox',
        eventId: event.id,
        eventType: event.event_type,
        attempts,
        exhausted,
      });
    }
  }
}

function parseDocumentPayload(event: ClaimedOutboxEvent): DocumentQueuePayload {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Payload documental inválido no outbox.');
  }
  const payload = event.payload as Record<string, Prisma.JsonValue>;
  if (
    typeof payload.documentId !== 'string' ||
    !Number.isInteger(payload.attempt) ||
    typeof payload.correlationId !== 'string'
  ) {
    throw new Error('Campos obrigatórios ausentes no evento documental.');
  }
  return {
    outboxEventId: event.id,
    documentId: payload.documentId,
    attempt: payload.attempt as number,
    correlationId: payload.correlationId,
  };
}

export function createDocumentQueue(redis: Redis): Queue<DocumentQueuePayload> {
  return new Queue<DocumentQueuePayload>(DOCUMENT_QUEUE, { connection: redis });
}
