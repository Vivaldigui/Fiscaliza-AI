import type { PrismaClient } from '@fiscaliza/database';
import { DeadlineStatus } from '@fiscaliza/database';
import { deadlinePolicySchema } from '@fiscaliza/shared';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerConfig } from './config';
import type { StructuredLogger } from './logger';

export const DEADLINE_QUEUE = 'deadline-maintenance';
const DEADLINE_JOB = 'refresh-deadline-statuses';

export async function createDeadlineMaintenance(
  prisma: PrismaClient,
  redis: Redis,
  config: WorkerConfig,
  logger: StructuredLogger,
) {
  const queue = new Queue(DEADLINE_QUEUE, { connection: redis });
  const worker = new Worker(
    DEADLINE_QUEUE,
    async (job) => {
      if (job.name !== DEADLINE_JOB) return;
      const startedAt = performance.now();
      const result = await refreshDeadlineStatuses(prisma, new Date());
      logger.info('Varredura idempotente de prazos concluída.', {
        stage: 'deadline-maintenance',
        jobId: job.id,
        ...result,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    { connection: redis, concurrency: 1 },
  );
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  await queue.upsertJobScheduler(
    'deadline-status-sweep',
    { every: config.DEADLINE_SWEEP_INTERVAL_MS },
    { name: DEADLINE_JOB, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
  return { queue, worker };
}

export async function refreshDeadlineStatuses(prisma: PrismaClient, now: Date) {
  const deadlines = await prisma.deadline.findMany({
    where: {
      status: {
        in: [DeadlineStatus.OPEN, DeadlineStatus.DUE_SOON, DeadlineStatus.EXTENDED],
      },
    },
  });
  let dueSoon = 0;
  let overdue = 0;
  for (const deadline of deadlines) {
    const snapshot = deadline.configurationSnapshot as Record<string, unknown>;
    const policy = deadlinePolicySchema.parse(snapshot.policy);
    const today = dateInTimezone(now, policy.timezone);
    const dueDate = deadline.currentDueDate.toISOString().slice(0, 10);
    const remaining = Math.round(
      (Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
    );
    const next =
      remaining < 0
        ? DeadlineStatus.OVERDUE
        : remaining <= policy.dueSoonDays
          ? DeadlineStatus.DUE_SOON
          : deadline.status === DeadlineStatus.EXTENDED
            ? DeadlineStatus.EXTENDED
            : DeadlineStatus.OPEN;
    if (next === deadline.status) continue;
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.deadline.updateMany({
        where: { id: deadline.id, version: deadline.version, status: deadline.status },
        data: { status: next, version: { increment: 1 } },
      });
      if (!changed.count) return;
      if (next === DeadlineStatus.DUE_SOON) dueSoon += 1;
      if (next === DeadlineStatus.OVERDUE) overdue += 1;
      if (next === DeadlineStatus.DUE_SOON || next === DeadlineStatus.OVERDUE) {
        await transaction.outboxEvent.create({
          data: {
            eventType: next === DeadlineStatus.DUE_SOON ? 'DeadlineApproaching' : 'DeadlineExpired',
            aggregateType: 'Deadline',
            aggregateId: deadline.id,
            payload: {
              deadlineId: deadline.id,
              propositionId: deadline.propositionId,
              dueDate,
            },
          },
        });
      }
    });
  }
  return { inspected: deadlines.length, dueSoon, overdue };
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
