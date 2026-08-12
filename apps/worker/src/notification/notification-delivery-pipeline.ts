import type { PrismaClient, NotificationStatus } from '@fiscaliza/database';
import { NotificationStatus as Status } from '@fiscaliza/database';
import type { Prisma } from '@fiscaliza/database';
import { UnrecoverableError } from 'bullmq';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';
import {
  type DeliveryRequest,
  type NotificationDeliveryProvider,
} from './notification-delivery-provider';

export const NOTIFICATION_DELIVERY_PROVIDER = 'n8n';

/**
 * Delivers a PENDING notification through the configured provider (n8n ->
 * UAZAPI). Concurrency-safe:
 *   - only one worker may claim a notification (guarded update on status +
 *     attempts);
 *   - every attempt is appended to `notification_delivery_attempts` (no
 *     lastError-only history);
 *   - retries are bounded by NOTIFICATION_QUEUE_ATTEMPTS with exponential
 *     backoff; an exhausted notification is terminal (FAILED) until a manual,
 *     authorized retry;
 *   - the real delivery status (SENT/DELIVERED) is driven by the n8n callback;
 *     a 2xx from n8n only means the relay accepted the request.
 */
export class NotificationDeliveryPipeline {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: NotificationDeliveryProvider,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  async process(notificationId: string, jobId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      this.logger.warn('Notificação não encontrada; job ignorado.', {
        notificationId,
        jobId,
        stage: 'notification-delivery',
      });
      return;
    }
    if (notification.status === Status.DELIVERED || notification.status === Status.CANCELLED) {
      this.logger.info('Notificação já finalizada; job duplicado ignorado.', {
        notificationId,
        jobId,
        status: notification.status,
        stage: 'notification-delivery',
      });
      return;
    }
    if (notification.status === Status.FAILED) {
      this.logger.info('Notificação em estado FAILED sem retry manual; job ignorado.', {
        notificationId,
        jobId,
        stage: 'notification-delivery',
      });
      return;
    }

    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        status: { in: [Status.PENDING, Status.PROCESSING] },
        attempts: notification.attempts,
      },
      data: { status: Status.PROCESSING, attempts: { increment: 1 }, nextAttemptAt: null },
    });
    if (!claimed.count) {
      this.logger.warn('Notificação reivindicada por outra execução; job ignorado.', {
        notificationId,
        jobId,
        stage: 'notification-delivery',
      });
      return;
    }
    const attemptNumber = notification.attempts + 1;
    await this.recordAttempt(notificationId, attemptNumber, Status.PROCESSING, null, null);
    await this.audit('NOTIFICATION_DELIVERY_ATTEMPTED', notificationId, {
      notificationId,
      attempt: attemptNumber,
      provider: NOTIFICATION_DELIVERY_PROVIDER,
    });

    try {
      const destination = await this.resolveDestination(notification);
      const request: DeliveryRequest = {
        notificationId,
        idempotencyKey: notification.idempotencyKey,
        notificationType: notification.type,
        channel: 'WHATSAPP',
        destination,
        payload: notification.payload as Record<string, unknown>,
      };
      const result = await this.provider.deliver(request);
      if (!result.accepted) {
        throw new Error('Provedor de entrega não aceitou a solicitação.');
      }
      await this.prisma.$transaction([
        this.prisma.notification.updateMany({
          where: { id: notificationId, status: Status.PROCESSING },
          data: {
            status: Status.SENT,
            sentAt: new Date(),
            ...(result.externalMessageId ? { externalMessageId: result.externalMessageId } : {}),
            lastError: null,
          },
        }),
        this.prisma.notificationDeliveryAttempt.updateMany({
          where: { notificationId, attempt: attemptNumber, status: Status.PROCESSING },
          data: {
            status: Status.SENT,
            ...(result.externalMessageId ? { externalMessageId: result.externalMessageId } : {}),
          },
        }),
      ]);
      await this.audit('NOTIFICATION_SENT', notificationId, {
        notificationId,
        attempt: attemptNumber,
        externalMessageId: result.externalMessageId ?? null,
      });
      this.logger.info('Notificação entregue ao relé n8n.', {
        notificationId,
        attempt: attemptNumber,
        externalMessageId: result.externalMessageId ?? null,
        stage: 'notification-delivery',
      });
    } catch (error) {
      const reason = this.describeError(error);
      await this.recordAttempt(notificationId, attemptNumber, Status.FAILED, null, reason);
      const exhausted = attemptNumber >= this.config.NOTIFICATION_QUEUE_ATTEMPTS;
      if (exhausted || error instanceof UnrecoverableError) {
        await this.prisma.notification.updateMany({
          where: { id: notificationId, status: Status.PROCESSING },
          data: { status: Status.FAILED, lastError: reason, nextAttemptAt: null },
        });
        await this.audit('NOTIFICATION_FAILED', notificationId, {
          notificationId,
          attempt: attemptNumber,
          exhausted: true,
        });
        this.logger.error('Entrega de notificação falhou de forma definitiva.', {
          notificationId,
          attempt: attemptNumber,
          exhausted: true,
          stage: 'notification-delivery',
          reason: reason.slice(0, 500),
        });
        if (!(error instanceof UnrecoverableError)) throw error;
        return;
      }
      const backoffMs = this.backoffMs(attemptNumber);
      await this.prisma.notification.updateMany({
        where: { id: notificationId, status: Status.PROCESSING },
        data: {
          status: Status.PENDING,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          lastError: reason,
        },
      });
      this.logger.warn('Falha temporária de entrega; retry agendado.', {
        notificationId,
        attempt: attemptNumber,
        nextAttemptAtMs: backoffMs,
        stage: 'notification-delivery',
      });
      throw error;
    }
  }

  /** Safety net: BullMQ exhausted retries without the pipeline marking FAILED. */
  async recordFinalFailure(notificationId: string, error: unknown): Promise<void> {
    const reason = this.describeError(error);
    await this.prisma.notification.updateMany({
      where: { id: notificationId, status: { in: [Status.PENDING, Status.PROCESSING] } },
      data: { status: Status.FAILED, lastError: reason, nextAttemptAt: null },
    });
    await this.audit('NOTIFICATION_FAILED', notificationId, {
      notificationId,
      exhausted: true,
    });
  }

  private async resolveDestination(notification: {
    id: string;
    identityId: string | null;
    destinationPhone: string | null;
    payload: Prisma.JsonValue;
  }): Promise<{ phone: string; instance: string | null }> {
    if (notification.identityId) {
      const identity = await this.prisma.whatsappIdentity.findUnique({
        where: { id: notification.identityId },
      });
      if (!identity || !identity.active || !identity.verifiedAt) {
        throw new UnrecoverableError(
          'Identidade WhatsApp inexistente, inativa ou não verificada; entrega cancelada.',
        );
      }
      return { phone: identity.phoneNumber, instance: identity.instance };
    }
    if (notification.destinationPhone) {
      const payload = notification.payload as Record<string, unknown>;
      const instance = typeof payload.instance === 'string' ? payload.instance : null;
      return { phone: notification.destinationPhone, instance };
    }
    throw new UnrecoverableError('Notificação sem destinatário de canal resolvível.');
  }

  private backoffMs(attempt: number): number {
    return this.config.NOTIFICATION_QUEUE_BACKOFF_MS * 2 ** (attempt - 1);
  }

  private recordAttempt(
    notificationId: string,
    attempt: number,
    status: NotificationStatus,
    externalMessageId: string | null,
    error: string | null,
  ) {
    return this.prisma.notificationDeliveryAttempt.create({
      data: {
        notificationId,
        attempt,
        status,
        provider: NOTIFICATION_DELIVERY_PROVIDER,
        externalMessageId,
        error: error ? sanitizeError(error) : null,
      },
    });
  }

  private audit(action: string, resourceId: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        action,
        resourceType: 'Notification',
        resourceId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Falha desconhecida na entrega.';
    return sanitizeError(message);
  }
}

function sanitizeError(error: string): string {
  return error
    .replace(/[+\d\s().-]{10,}/g, '')
    .replace(/(token|key|secret)[=:]\S+/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
}
