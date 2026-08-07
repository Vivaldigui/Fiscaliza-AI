import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CountingMode,
  DeadlineExtensionRequestStatus,
  DeadlineStatus,
  DocumentSecurityStatus,
  Prisma,
  ProcessingStatus,
  PropositionType,
} from '@fiscaliza/database';
import { deadlinePolicySchema } from '@fiscaliza/shared';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import {
  calculateDueDate,
  countSuspendedDays,
  databaseDate,
  dateInTimeZone,
  daysUntil,
  isoDatabaseDate,
} from './deadline-calculator';
import type {
  CreateExtensionRequestDto,
  ExtendDeadlineDto,
  ListDeadlinesDto,
  ResumeDeadlineDto,
  SuspendDeadlineDto,
} from './dto/deadline.dto';

const snapshotSchema = z.object({
  settingKey: z.string(),
  settingVersion: z.number().int().positive(),
  capturedAt: z.string(),
  policy: deadlinePolicySchema,
  holidays: z.array(z.object({ date: z.string(), name: z.string(), scope: z.string() })),
});

export type DeadlineSnapshot = z.infer<typeof snapshotSchema>;

@Injectable()
export class DeadlinesService {
  constructor(private readonly prisma: PrismaService) {}

  async prepare(type: PropositionType, baseDate: string) {
    const settingKey = `deadlines.policy.${type}`;
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: settingKey } });
    if (!setting) throw new ConflictException(`Política de prazo ausente para ${type}.`);
    const policy = deadlinePolicySchema.parse(setting.value);
    validateTimezone(policy.timezone);
    const holidays = await this.prisma.holiday.findMany({
      where: { active: true, scope: { in: policy.holidayScopes } },
      orderBy: { date: 'asc' },
      select: { date: true, name: true, scope: true },
    });
    const holidaySnapshot = holidays.map((holiday) => ({
      date: isoDatabaseDate(holiday.date),
      name: holiday.name,
      scope: holiday.scope,
    }));
    const calculation = calculateDueDate(
      baseDate,
      policy.initialResponseDays,
      policy,
      holidaySnapshot,
    );
    const snapshot: DeadlineSnapshot = {
      settingKey,
      settingVersion: setting.version,
      capturedAt: new Date().toISOString(),
      policy,
      holidays: holidaySnapshot,
    };
    return {
      baseDate: databaseDate(baseDate),
      originalDueDate: databaseDate(calculation.dueDate),
      currentDueDate: databaseDate(calculation.dueDate),
      countingMode: policy.countingMode as CountingMode,
      timezone: policy.timezone,
      configurationSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      status: DeadlineStatus.OPEN,
    };
  }

  async list(query: ListDeadlinesDto) {
    return this.prisma.deadline.findMany({
      where: {
        ...(query.propositionId ? { propositionId: query.propositionId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.dueFrom || query.dueTo
          ? {
              currentDueDate: {
                ...(query.dueFrom ? { gte: databaseDate(query.dueFrom) } : {}),
                ...(query.dueTo ? { lte: databaseDate(query.dueTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ currentDueDate: 'asc' }, { createdAt: 'asc' }],
      take: query.limit,
      include: {
        proposition: {
          select: { id: true, type: true, number: true, year: true, subject: true, status: true },
        },
        extensions: { orderBy: { grantedAt: 'desc' } },
        suspensions: { orderBy: { startedAt: 'desc' } },
      },
    });
  }

  async extend(id: string, dto: ExtendDeadlineDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const deadline = await transaction.deadline.findUnique({ where: { id } });
      if (!deadline) throw new NotFoundException('Prazo não encontrado.');
      if (deadline.status === DeadlineStatus.SUSPENDED)
        throw new ConflictException('Retome o prazo antes de prorrogá-lo.');
      const snapshot = parseSnapshot(deadline.configurationSnapshot);
      const days = dto.extensionDays ?? snapshot.policy.extensionDays;
      if (days <= 0) throw new ConflictException('A prorrogação deve possuir ao menos um dia.');
      if (dto.requestId) {
        const request = await transaction.deadlineExtensionRequest.findUnique({
          where: { id: dto.requestId },
        });
        if (!request || request.deadlineId !== id)
          throw new NotFoundException('Pedido de prorrogação não encontrado para este prazo.');
        if (request.status !== DeadlineExtensionRequestStatus.RECEIVED)
          throw new ConflictException('Pedido de prorrogação já decidido.');
      }
      const previous = isoDatabaseDate(deadline.currentDueDate);
      const calculation = calculateDueDate(previous, days, snapshot.policy, snapshot.holidays);
      const changed = await transaction.deadline.updateMany({
        where: { id, version: dto.version },
        data: {
          currentDueDate: databaseDate(calculation.dueDate),
          status: DeadlineStatus.EXTENDED,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw concurrentDeadlineError();
      const extension = await transaction.deadlineExtension.create({
        data: {
          deadlineId: id,
          previousDueDate: deadline.currentDueDate,
          newDueDate: databaseDate(calculation.dueDate),
          extensionDays: days,
          grantedAt: new Date(),
          changedById: actorId,
          reason: dto.reason,
          requestId: dto.requestId,
        },
      });
      if (dto.requestId) {
        await transaction.deadlineExtensionRequest.update({
          where: { id: dto.requestId },
          data: {
            status: DeadlineExtensionRequestStatus.GRANTED,
            decidedAt: new Date(),
            decidedById: actorId,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'DEADLINE_EXTENDED',
          resourceType: 'Deadline',
          resourceId: id,
          previousState: { dueDate: previous, version: deadline.version },
          newState: { dueDate: calculation.dueDate, version: deadline.version + 1, days },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'DeadlineExtended',
          aggregateType: 'Deadline',
          aggregateId: id,
          payload: {
            deadlineId: id,
            propositionId: deadline.propositionId,
            previousDueDate: previous,
            newDueDate: calculation.dueDate,
          },
        },
      });
      return extension;
    });
  }

  async createExtensionRequest(id: string, dto: CreateExtensionRequestDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const deadline = await transaction.deadline.findUnique({ where: { id } });
      if (!deadline) throw new NotFoundException('Prazo não encontrado.');
      if (dto.documentId) await assertOperationalDocument(transaction, dto.documentId);
      const request = await transaction.deadlineExtensionRequest.create({
        data: {
          propositionId: deadline.propositionId,
          deadlineId: id,
          documentId: dto.documentId,
          requestedAt: databaseDate(dto.requestedAt),
          requestedDueDate: dto.requestedDueDate ? databaseDate(dto.requestedDueDate) : undefined,
          requestedDays: dto.requestedDays,
          reason: dto.reason,
          registeredById: actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'DEADLINE_EXTENSION_REQUEST_RECORDED',
          resourceType: 'DeadlineExtensionRequest',
          resourceId: request.id,
          metadata: { deadlineId: id, propositionId: deadline.propositionId },
        },
      });
      return request;
    });
  }

  async suspend(id: string, dto: SuspendDeadlineDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const deadline = await transaction.deadline.findUnique({ where: { id } });
      if (!deadline) throw new NotFoundException('Prazo não encontrado.');
      const snapshot = parseSnapshot(deadline.configurationSnapshot);
      if (!snapshot.policy.suspensionEnabled)
        throw new ForbiddenException('Suspensão desabilitada na política deste prazo.');
      const changed = await transaction.deadline.updateMany({
        where: { id, version: dto.version, status: { not: DeadlineStatus.SUSPENDED } },
        data: { status: DeadlineStatus.SUSPENDED, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw concurrentDeadlineError();
      const suspension = await transaction.deadlineSuspension.create({
        data: {
          deadlineId: id,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(),
          changedById: actorId,
          reason: dto.reason,
          previousDueDate: deadline.currentDueDate,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'DEADLINE_SUSPENDED',
          resourceType: 'Deadline',
          resourceId: id,
          metadata: { suspensionId: suspension.id },
        },
      });
      return suspension;
    });
  }

  async resume(id: string, dto: ResumeDeadlineDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const deadline = await transaction.deadline.findUnique({ where: { id } });
      if (!deadline) throw new NotFoundException('Prazo não encontrado.');
      const suspension = await transaction.deadlineSuspension.findFirst({
        where: { deadlineId: id, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!suspension || deadline.status !== DeadlineStatus.SUSPENDED)
        throw new ConflictException('Não existe suspensão aberta para este prazo.');
      const endedAt = dto.endedAt ? new Date(dto.endedAt) : new Date();
      const snapshot = parseSnapshot(deadline.configurationSnapshot);
      const suspendedDays = countSuspendedDays(
        suspension.startedAt,
        endedAt,
        snapshot.policy,
        snapshot.holidays,
      );
      const previous = isoDatabaseDate(deadline.currentDueDate);
      const newDueDate = calculateDueDate(
        previous,
        suspendedDays,
        snapshot.policy,
        snapshot.holidays,
      ).dueDate;
      const changed = await transaction.deadline.updateMany({
        where: { id, version: dto.version, status: DeadlineStatus.SUSPENDED },
        data: {
          currentDueDate: databaseDate(newDueDate),
          status: DeadlineStatus.OPEN,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw concurrentDeadlineError();
      await transaction.deadlineSuspension.update({
        where: { id: suspension.id },
        data: { endedAt, resumedById: actorId, newDueDate: databaseDate(newDueDate) },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'DEADLINE_RESUMED',
          resourceType: 'Deadline',
          resourceId: id,
          previousState: { dueDate: previous, status: DeadlineStatus.SUSPENDED },
          newState: { dueDate: newDueDate, status: DeadlineStatus.OPEN, suspendedDays },
        },
      });
      return transaction.deadline.findUniqueOrThrow({
        where: { id },
        include: { suspensions: { orderBy: { startedAt: 'desc' } } },
      });
    });
  }

  async refreshStatuses(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
    const deadlines = await this.prisma.deadline.findMany({
      where: {
        status: { in: [DeadlineStatus.OPEN, DeadlineStatus.DUE_SOON, DeadlineStatus.EXTENDED] },
      },
    });
    let dueSoon = 0;
    let overdue = 0;
    for (const deadline of deadlines) {
      const snapshot = parseSnapshot(deadline.configurationSnapshot);
      const today = dateInTimeZone(now, snapshot.policy.timezone);
      const remaining = daysUntil(today, isoDatabaseDate(deadline.currentDueDate));
      const next =
        remaining < 0
          ? DeadlineStatus.OVERDUE
          : remaining <= snapshot.policy.dueSoonDays
            ? DeadlineStatus.DUE_SOON
            : deadline.status === DeadlineStatus.EXTENDED
              ? DeadlineStatus.EXTENDED
              : DeadlineStatus.OPEN;
      if (next === deadline.status) continue;
      const updated = await this.prisma.deadline.updateMany({
        where: { id: deadline.id, version: deadline.version, status: deadline.status },
        data: { status: next, version: { increment: 1 } },
      });
      if (!updated.count) continue;
      if (next === DeadlineStatus.DUE_SOON) dueSoon += 1;
      if (next === DeadlineStatus.OVERDUE) overdue += 1;
      if (next === DeadlineStatus.DUE_SOON || next === DeadlineStatus.OVERDUE) {
        await this.prisma.outboxEvent.create({
          data: {
            eventType: next === DeadlineStatus.DUE_SOON ? 'DeadlineApproaching' : 'DeadlineExpired',
            aggregateType: 'Deadline',
            aggregateId: deadline.id,
            payload: {
              deadlineId: deadline.id,
              propositionId: deadline.propositionId,
              dueDate: isoDatabaseDate(deadline.currentDueDate),
            },
          },
        });
      }
    }
    return { dueSoon, overdue };
  }

  static responseReceiptData(receivedAt: Date) {
    return {
      status: DeadlineStatus.RESPONSE_RECEIVED,
      responseReceivedAt: receivedAt,
      version: { increment: 1 },
    } as const;
  }
}

function parseSnapshot(value: Prisma.JsonValue): DeadlineSnapshot {
  return snapshotSchema.parse(value);
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
  } catch {
    throw new ConflictException('Timezone inválido na política de prazo.');
  }
}

function concurrentDeadlineError(): ConflictException {
  return new ConflictException('O prazo foi alterado por outro usuário. Recarregue os dados.');
}

async function assertOperationalDocument(
  transaction: Prisma.TransactionClient,
  documentId: string,
) {
  const document = await transaction.document.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundException('Documento não encontrado.');
  if (
    document.securityStatus !== DocumentSecurityStatus.CLEAN ||
    document.processingStatus !== ProcessingStatus.COMPLETED
  ) {
    throw new ForbiddenException(
      'Somente documento concluído e aprovado pela segurança pode ser vinculado.',
    );
  }
}
