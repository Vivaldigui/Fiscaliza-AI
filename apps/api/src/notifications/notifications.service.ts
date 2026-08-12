import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, Prisma, type Notification } from '@fiscaliza/database';
import { maskPhone } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';

export interface ListNotificationsQuery {
  type?: string;
  status?: string;
  channel?: string;
  limit?: number;
  cursor?: string;
}

const READABLE_INCLUDE = {
  recipient: { select: { id: true, email: true, name: true } },
  identity: {
    select: { id: true, phoneNumber: true, instance: true },
  },
} satisfies Prisma.NotificationInclude;

const MAX_LIMIT = 200;

/**
 * Operational API over notifications (Fase 5B).
 *
 * `ADMIN`/`SECRETARIAT` can inspect, retry and cancel; `AUDITOR` is read-only
 * (enforced by the RolesGuard on the controller). Payload content is never
 * returned; phones are masked and errors sanitized.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListNotificationsQuery) {
    const limit = Math.min(query.limit ?? 50, MAX_LIMIT);
    const where: Prisma.NotificationWhereInput = {
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.cursor
        ? {
            id: {
              lt: query.cursor,
            },
          }
        : {}),
    };
    const items = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: READABLE_INCLUDE,
    });
    return {
      items: items.map(toView),
      nextCursor: items.length === limit ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async get(id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      include: {
        ...READABLE_INCLUDE,
        deliveryAttempts: { orderBy: { attempt: 'asc' } },
      },
    });
    if (!notification) throw new NotFoundException('Notificação não encontrada.');
    return {
      ...toView(notification),
      deliveryAttempts: notification.deliveryAttempts.map((attempt) => ({
        attempt: attempt.attempt,
        status: attempt.status,
        provider: attempt.provider,
        externalMessageId: attempt.externalMessageId,
        error: sanitizeError(attempt.error),
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      })),
    };
  }

  async retry(id: string, requestId?: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notificação não encontrada.');
    if (notification.status === NotificationStatus.CANCELLED) {
      throw new ConflictException('Notificação cancelada não pode ser reenviada.');
    }
    if (notification.status === NotificationStatus.DELIVERED) {
      throw new ConflictException('Notificação já entregue não precisa de nova tentativa.');
    }
    const reset = await this.prisma.notification.updateMany({
      where: { id, status: { not: NotificationStatus.CANCELLED } },
      data: {
        status: NotificationStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (!reset.count) throw new ConflictException('Notificação não pode ser reenviada agora.');
    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'NotificationRetryRequested',
        aggregateType: 'Notification',
        aggregateId: id,
        payload: { notificationId: id },
      },
    });
    await this.audit('NOTIFICATION_RETRY_REQUESTED', id, requestId, { notificationId: id });
    return this.get(id);
  }

  async cancel(id: string, requestId?: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notificação não encontrada.');
    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.DELIVERED
    ) {
      throw new ConflictException('Notificação já enviada não pode ser cancelada.');
    }
    const updated = await this.prisma.notification.updateMany({
      where: {
        id,
        status: { in: [NotificationStatus.PENDING, NotificationStatus.PROCESSING] },
      },
      data: { status: NotificationStatus.CANCELLED },
    });
    if (!updated.count) throw new ConflictException('Notificação não pode ser cancelada agora.');
    await this.audit('NOTIFICATION_CANCELLED', id, requestId, { notificationId: id });
    return this.get(id);
  }

  private audit(
    action: string,
    resourceId: string,
    requestId: string | undefined,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        action,
        resourceType: 'Notification',
        resourceId,
        requestId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

function toView(
  notification: Notification & {
    recipient?: { id: string; email: string; name: string } | null;
    identity?: { id: string; phoneNumber: string; instance: string } | null;
  },
) {
  return {
    id: notification.id,
    type: notification.type,
    channel: notification.channel,
    template: notification.template,
    templateVersion: notification.templateVersion,
    status: notification.status,
    attempts: notification.attempts,
    externalMessageId: notification.externalMessageId,
    lastError: sanitizeError(notification.lastError),
    sentAt: notification.sentAt,
    deliveredAt: notification.deliveredAt,
    nextAttemptAt: notification.nextAttemptAt,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    recipient: notification.recipient
      ? {
          userId: notification.recipient.id,
          email: notification.recipient.email,
          name: notification.recipient.name,
        }
      : null,
    identity: notification.identity
      ? {
          identityId: notification.identity.id,
          phoneMasked: maskPhone(notification.identity.phoneNumber),
          instance: notification.identity.instance,
        }
      : null,
  };
}

function sanitizeError(error: string | null | undefined): string | null {
  if (!error) return null;
  return error
    .replace(/[+\d\s().-]{10,}/g, '')
    .replace(/(token|key|secret)[=:]\S+/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
}
