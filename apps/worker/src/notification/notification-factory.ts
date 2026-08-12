import type { Prisma, PrismaClient } from '@fiscaliza/database';
import { NotificationChannel, NotificationStatus } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';

export const RESPONSE_ANALYSIS_TEMPLATE = 'response-analysis-completed.v1';
export const RESPONSE_ANALYSIS_TEMPLATE_VERSION = 'phase5b-response-analysis-v1';
export const DEADLINE_TEMPLATE = 'deadline-alert.v1';
export const DEADLINE_TEMPLATE_VERSION = 'phase5b-deadline-alert-v1';

interface FactoryIdentity {
  identityId: string;
  instance: string;
  displayName: string;
}

/**
 * Idempotent notification creation from domain events (Fase 5B).
 *
 * - `ResponseAnalysisCompleted`: only RESPONSE analyses in COMPLETED state
 *   produce notifications; extraction/PENDING/PROCESSING/FAILED/
 *   NEEDS_HUMAN_REVIEW never do. Counts come from the persisted AnalysisItems.
 * - `DeadlineApproaching` / `DeadlineExpired`: one notification per authorized
 *   author's verified identity, never re-created per sweep run (idempotencyKey
 *   includes deadlineId + eventType + dueDate).
 *
 * Every notification is created in the same transaction as the outbox event so
 * a created notification always has a recoverable delivery job.
 */
export class NotificationFactory {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  async processResponseAnalysis(analysisId: string, jobId: string): Promise<void> {
    if (!this.config.RESPONSE_NOTIFICATIONS_ENABLED || !this.config.WHATSAPP_ENABLED) {
      this.logger.info('Notificações de análise desabilitadas; evento ignorado.', {
        analysisId,
        jobId,
        stage: 'notification-factory',
      });
      return;
    }
    const analysis = await this.prisma.analysis.findUnique({
      where: { id: analysisId },
      include: {
        proposition: {
          include: { authors: { select: { councilor: { select: { displayName: true } } } } },
        },
      },
    });
    if (!analysis) {
      this.logger.warn('Análise não encontrada para notificação; ignorada.', {
        analysisId,
        jobId,
        stage: 'notification-factory',
      });
      return;
    }
    if (analysis.type !== 'REQUEST_RESPONSE' && analysis.type !== 'INDICATION_RESPONSE') {
      this.logger.info('Análise sem contrato de resposta; nenhuma notificação.', {
        analysisId,
        type: analysis.type,
        stage: 'notification-factory',
      });
      return;
    }
    if (analysis.status !== 'COMPLETED') {
      this.logger.info('Análise não concluída; nenhuma notificação automática.', {
        analysisId,
        status: analysis.status,
        stage: 'notification-factory',
      });
      return;
    }

    const counts = await this.countItemStatuses(analysisId);
    const text = buildResponseAnalysisText({
      propositionType: analysis.proposition.type,
      number: analysis.proposition.number,
      year: analysis.proposition.year,
      subject: analysis.proposition.subject,
      counts,
    });
    const identities = await this.authorizedIdentities(analysis.propositionId);
    const payload = {
      text,
      analysisId,
      propositionId: analysis.propositionId,
      type: analysis.proposition.type,
      number: analysis.proposition.number,
      year: analysis.proposition.year,
      subject: analysis.proposition.subject,
      counts,
      templateVersion: RESPONSE_ANALYSIS_TEMPLATE_VERSION,
    };

    for (const identity of identities) {
      const idempotencyKey = `response-analysis:${analysisId}:${RESPONSE_ANALYSIS_TEMPLATE_VERSION}:${identity.identityId}`;
      await this.createNotification({
        type: 'RESPONSE_ANALYSIS_COMPLETED',
        identityId: identity.identityId,
        analysisId,
        template: RESPONSE_ANALYSIS_TEMPLATE,
        templateVersion: RESPONSE_ANALYSIS_TEMPLATE_VERSION,
        payload,
        idempotencyKey,
        aggregateId: analysisId,
      });
    }
    this.logger.info('Notificações de análise de resposta criadas.', {
      analysisId,
      recipientCount: identities.length,
      counts,
      stage: 'notification-factory',
    });
  }

  async processDeadline(
    eventType: 'DeadlineApproaching' | 'DeadlineExpired',
    deadlineId: string,
    dueDate: string,
    jobId: string,
  ): Promise<void> {
    if (!this.config.DEADLINE_NOTIFICATIONS_ENABLED || !this.config.WHATSAPP_ENABLED) {
      this.logger.info('Alertas de prazo desabilitados; evento ignorado.', {
        deadlineId,
        eventType,
        jobId,
        stage: 'notification-factory',
      });
      return;
    }
    const deadline = await this.prisma.deadline.findUnique({
      where: { id: deadlineId },
      include: {
        proposition: { select: { id: true, type: true, number: true, year: true, subject: true } },
      },
    });
    if (!deadline) {
      this.logger.warn('Prazo não encontrado para alerta; ignorado.', {
        deadlineId,
        eventType,
        stage: 'notification-factory',
      });
      return;
    }
    const identities = await this.authorizedIdentities(deadline.propositionId);
    const notificationType =
      eventType === 'DeadlineApproaching' ? 'DEADLINE_APPROACHING' : 'DEADLINE_EXPIRED';
    const payload = {
      propositionId: deadline.propositionId,
      type: deadline.proposition.type,
      number: deadline.proposition.number,
      year: deadline.proposition.year,
      subject: deadline.proposition.subject,
      dueDate,
      eventType,
      templateVersion: DEADLINE_TEMPLATE_VERSION,
    };

    for (const identity of identities) {
      const idempotencyKey = `deadline:${deadlineId}:${eventType}:${dueDate}:${identity.identityId}:${DEADLINE_TEMPLATE_VERSION}`;
      await this.createNotification({
        type: notificationType,
        identityId: identity.identityId,
        deadlineId,
        template: DEADLINE_TEMPLATE,
        templateVersion: DEADLINE_TEMPLATE_VERSION,
        payload,
        idempotencyKey,
        aggregateId: deadlineId,
      });
    }
    this.logger.info('Alertas de prazo criados.', {
      deadlineId,
      eventType,
      dueDate,
      recipientCount: identities.length,
      stage: 'notification-factory',
    });
  }

  /** Every author (primary + coauthors) with an active, verified identity. */
  private async authorizedIdentities(propositionId: string): Promise<FactoryIdentity[]> {
    const authors = await this.prisma.propositionAuthor.findMany({
      where: { propositionId },
      select: {
        councilor: {
          select: {
            displayName: true,
            whatsappIdentities: {
              where: { active: true },
              select: { id: true, instance: true, verifiedAt: true },
            },
          },
        },
      },
    });
    const result: FactoryIdentity[] = [];
    for (const author of authors) {
      for (const identity of author.councilor.whatsappIdentities) {
        if (!identity.verifiedAt) continue;
        result.push({
          identityId: identity.id,
          instance: identity.instance,
          displayName: author.councilor.displayName,
        });
      }
    }
    return result;
  }

  private async countItemStatuses(analysisId: string) {
    const groups = await this.prisma.analysisItem.groupBy({
      by: ['currentStatus'],
      where: { analysisId },
      _count: { _all: true },
    });
    return Object.fromEntries(
      groups.map((group) => [group.currentStatus, group._count._all]),
    ) as Record<string, number>;
  }

  private async createNotification(params: {
    type:
      | 'WHATSAPP_CONVERSATION_REPLY'
      | 'RESPONSE_ANALYSIS_COMPLETED'
      | 'DEADLINE_APPROACHING'
      | 'DEADLINE_EXPIRED';
    identityId: string;
    analysisId?: string;
    deadlineId?: string;
    template: string;
    templateVersion: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    aggregateId: string;
  }) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.notification.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
          select: { id: true },
        });
        if (existing) return;
        const created = await transaction.notification.create({
          data: {
            type: params.type,
            channel: NotificationChannel.WHATSAPP,
            identityId: params.identityId,
            analysisId: params.analysisId ?? null,
            deadlineId: params.deadlineId ?? null,
            template: params.template,
            templateVersion: params.templateVersion,
            payload: params.payload as unknown as Prisma.InputJsonValue,
            idempotencyKey: params.idempotencyKey,
            status: NotificationStatus.PENDING,
          },
          select: { id: true },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: 'NotificationCreated',
            aggregateType: 'Notification',
            aggregateId: params.aggregateId,
            payload: { notificationId: created.id } as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.logger.info('Notificação já existente; duplicação ignorada.', {
          idempotencyKey: params.idempotencyKey,
          stage: 'notification-factory',
        });
        return;
      }
      throw error;
    }
  }
}

export function buildResponseAnalysisText(params: {
  propositionType: 'REQUEST' | 'INDICATION';
  number: number;
  year: number;
  subject: string;
  counts: Record<string, number>;
}): string {
  const typeLabel = params.propositionType === 'REQUEST' ? 'Requerimento' : 'Indicação';
  const lines: string[] = [`📄 Resposta recebida — ${typeLabel} ${params.number}/${params.year}`];
  if (params.subject) lines.push(`\nAssunto: ${params.subject}`);
  lines.push('\nA análise identificou:');
  const answered = params.counts.ANSWERED ?? 0;
  const partial = params.counts.PARTIALLY_ANSWERED ?? 0;
  const notAnswered = params.counts.NOT_ANSWERED ?? 0;
  const other = Object.entries(params.counts).filter(
    ([status, count]) =>
      !['ANSWERED', 'PARTIALLY_ANSWERED', 'NOT_ANSWERED'].includes(status) && count > 0,
  );
  lines.push(`✅ ${answered} respondido${answered === 1 ? '' : 's'}`);
  lines.push(`🟡 ${partial} parcialmente respondido${partial === 1 ? '' : 's'}`);
  lines.push(`🔴 ${notAnswered} sem resposta identificada`);
  for (const [status, count] of other) {
    lines.push(`• ${status.replaceAll('_', ' ').toLowerCase()}: ${count}`);
  }
  lines.push('\nVocê pode me perguntar qualquer coisa sobre o requerimento ou a resposta.');
  return lines.join('\n');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}
