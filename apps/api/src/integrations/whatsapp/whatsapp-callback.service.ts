import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, Prisma } from '@fiscaliza/database';
import { PrismaService } from '../../database/prisma.service';
import type { WhatsappDeliveryCallbackDto } from './dto/whatsapp.dto';

const DELIVERY_STATUS_ACTIONS: Record<'SENT' | 'DELIVERED' | 'FAILED', string> = {
  SENT: 'NOTIFICATION_SENT',
  DELIVERED: 'NOTIFICATION_DELIVERED',
  FAILED: 'NOTIFICATION_FAILED',
};

/**
 * Delivery status callbacks sent by n8n after UAZAPI accepts/delivers a
 * message. Transitions are validated: a late callback can never regress
 * DELIVERED to SENT/FAILED, and FAILED only moves forward from a delivery in
 * progress. All transitions use guarded updates so concurrent callbacks cannot
 * race each other.
 */
@Injectable()
export class WhatsappCallbackService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(dto: WhatsappDeliveryCallbackDto, requestId?: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: dto.notificationId },
    });
    if (!notification) throw new NotFoundException('Notificação não encontrada.');
    if (notification.idempotencyKey !== dto.idempotencyKey) {
      throw new ConflictException('Chave de idempotência não corresponde à notificação.');
    }
    if (!canTransition(notification.status, dto.status)) {
      throw new ConflictException(
        `Transição inválida de status ${notification.status} para ${dto.status}.`,
      );
    }

    const data: Prisma.NotificationUpdateManyMutationInput = {};
    let whereStatus: NotificationStatus[];
    if (dto.status === 'SENT') {
      whereStatus = [
        NotificationStatus.PENDING,
        NotificationStatus.PROCESSING,
        NotificationStatus.SENT,
      ];
      data.status = NotificationStatus.SENT;
      data.sentAt = new Date();
      if (dto.externalMessageId) data.externalMessageId = dto.externalMessageId;
      data.lastError = null;
    } else if (dto.status === 'DELIVERED') {
      whereStatus = [
        NotificationStatus.PENDING,
        NotificationStatus.PROCESSING,
        NotificationStatus.SENT,
        NotificationStatus.DELIVERED,
      ];
      data.status = NotificationStatus.DELIVERED;
      data.deliveredAt = new Date();
      if (dto.externalMessageId) data.externalMessageId = dto.externalMessageId;
      data.lastError = null;
    } else {
      whereStatus = [NotificationStatus.PENDING, NotificationStatus.PROCESSING];
      data.status = NotificationStatus.FAILED;
      data.lastError = sanitizeError(dto.error);
    }

    const updated = await this.prisma.notification.updateMany({
      where: { id: dto.notificationId, status: { in: whereStatus } },
      data,
    });
    if (!updated.count) {
      throw new ConflictException('Status da notificação mudou concorrentemente.');
    }
    await this.audit(
      DELIVERY_STATUS_ACTIONS[dto.status],
      'Notification',
      dto.notificationId,
      requestId,
      {
        idempotencyKey: dto.idempotencyKey,
        externalMessageId: dto.externalMessageId ?? null,
      },
    );
    return {
      notificationId: dto.notificationId,
      status: dto.status,
      externalMessageId: dto.externalMessageId ?? null,
    };
  }

  private audit(
    action: string,
    resourceType: string,
    resourceId: string,
    requestId: string | undefined,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        action,
        resourceType,
        resourceId,
        requestId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

function canTransition(
  current: NotificationStatus,
  incoming: 'SENT' | 'DELIVERED' | 'FAILED',
): boolean {
  if (current === incoming) return true;
  if (current === NotificationStatus.DELIVERED) return false;
  if (current === NotificationStatus.CANCELLED) return false;
  if (incoming === 'DELIVERED') {
    return (
      current === NotificationStatus.PENDING ||
      current === NotificationStatus.PROCESSING ||
      current === NotificationStatus.SENT
    );
  }
  if (incoming === 'SENT') {
    return (
      current === NotificationStatus.PENDING ||
      current === NotificationStatus.PROCESSING ||
      current === NotificationStatus.SENT
    );
  }
  // FAILED
  return current === NotificationStatus.PENDING || current === NotificationStatus.PROCESSING;
}

function sanitizeError(error: string | undefined): string | null {
  if (!error) return null;
  return error
    .replace(/[+\d\s().-]{10,}/g, '')
    .replace(/(token|key|secret)[=:]\S+/gi, '$1=[REDACTED]')
    .slice(0, 2_000);
}
