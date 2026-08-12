import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationChannel,
  ConversationMessageStatus,
  InboundMessageStatus,
  MessageRole,
  NotificationChannel,
  NotificationStatus,
  Prisma,
  UserStatus,
  type WhatsappIdentity,
} from '@fiscaliza/database';
import {
  maskPhone,
  normalizePhoneE164,
  phoneFingerprint,
  whatsappSessionKey,
} from '@fiscaliza/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../infrastructure/redis.service';
import { WhatsappSessionService } from './whatsapp-session.service';
import { WhatsappInboundDto } from './dto/whatsapp.dto';

export const WHATSAPP_DENY_TEMPLATE = 'whatsapp-neutral-deny.v1';
export const WHATSAPP_DENY_TEMPLATE_VERSION = 'phase5b-whatsapp-deny-v1';
export const WHATSAPP_CONVERSATION_REPLY_TEMPLATE = 'whatsapp-conversation-reply.v1';
export const WHATSAPP_CONVERSATION_REPLY_TEMPLATE_VERSION = 'phase5b-whatsapp-reply-v1';

const DEFAULT_NEUTRAL_REPLY =
  'Este número não está habilitado para consultas no Fiscaliza AI. Entre em contato com a administração da Câmara para solicitar acesso.';

export interface WhatsappInboundResult {
  accepted: boolean;
  duplicate?: boolean;
  pending?: boolean;
  neutralReply?: boolean;
  inboundMessageId: string;
  conversationId?: string;
}

const identityInclude = {
  councilor: {
    select: {
      userId: true,
      active: true,
      user: { select: { id: true, status: true } },
    },
  },
} satisfies Prisma.WhatsappIdentityInclude;

type ResolvedIdentity = Prisma.WhatsappIdentityGetPayload<{ include: typeof identityInclude }>;

/**
 * Inbound WhatsApp envelope processing (Phase 5B).
 *
 * The HTTP webhook only persists state and requests async work:
 *   - duplicates return the same accepted result (instance + messageId);
 *   - the same messageId with a different payload is a conflict;
 *   - unknown/inactive/unverified identities are denied with a neutral reply
 *     and NO document search, RAG or LLM call;
 *   - valid identities create/reuse a WHATSAPP conversation, enqueue the
 *     existing ConversationAnswerPipeline through the outbox and touch the
 *     temporary Redis session.
 */
@Injectable()
export class WhatsappInboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: WhatsappSessionService,
    private readonly config: ConfigService,
  ) {}

  async receive(dto: WhatsappInboundDto, requestId?: string): Promise<WhatsappInboundResult> {
    if (!this.config.getOrThrow<boolean>('WHATSAPP_ENABLED')) {
      throw new ServiceUnavailableException(
        'WhatsApp desabilitado operacionalmente (WHATSAPP_ENABLED=false).',
      );
    }
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) {
      throw new UnauthorizedException('Telefone em formato inválido.');
    }
    await this.assertRateLimit(dto.instance, phone);

    const phoneHash = phoneFingerprint(phone);
    const payloadHash = computeInboundPayloadHash({
      messageId: dto.messageId,
      phone,
      text: dto.text,
      timestamp: dto.timestamp,
      instance: dto.instance,
      metadata: dto.metadata ?? {},
    });

    const existing = await this.prisma.inboundMessage.findUnique({
      where: { instance_messageId: { instance: dto.instance, messageId: dto.messageId } },
    });
    if (existing) {
      if (existing.payloadHash === payloadHash) {
        await this.audit('WHATSAPP_INBOUND_DUPLICATE', 'InboundMessage', existing.id, requestId, {
          instance: dto.instance,
          phoneHash,
        });
        return { accepted: true, duplicate: true, inboundMessageId: existing.id };
      }
      await this.audit('WHATSAPP_INBOUND_DUPLICATE', 'InboundMessage', existing.id, requestId, {
        instance: dto.instance,
        phoneHash,
        payloadConflict: true,
      });
      throw new ConflictException('Mensagem já recebida com conteúdo diferente.');
    }

    const identity = await this.findIdentity(dto.instance, phone);
    const identityState = this.evaluateIdentity(identity);

    return this.prisma.$transaction(async (transaction) => {
      const inbound = await transaction.inboundMessage.create({
        data: {
          instance: dto.instance,
          messageId: dto.messageId,
          phoneHash,
          payloadHash,
          status: InboundMessageStatus.RECEIVED,
          receivedAt: new Date(),
        },
      });

      if (identityState !== 'OK') {
        await transaction.inboundMessage.update({
          where: { id: inbound.id },
          data: {
            status: InboundMessageStatus.DENIED,
            processedAt: new Date(),
            identityId: identity?.id ?? null,
            error: identityState,
          },
        });
        await this.audit('WHATSAPP_IDENTITY_DENIED', 'InboundMessage', inbound.id, requestId, {
          instance: dto.instance,
          phoneHash,
          reason: identityState,
        });
        await this.createNeutralReplyNotification(transaction, inbound.id, dto, phone);
        return { accepted: true, neutralReply: true, inboundMessageId: inbound.id };
      }

      const user = identity!.councilor.user!;
      const conversation = await this.findOrCreateConversation(transaction, identity!.id, user.id);
      const inputHash = createHash('sha256').update(dto.text.trim()).digest('hex');
      await transaction.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: dto.text.trim(),
          inputHash,
        },
      });
      const assistant = await transaction.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: MessageRole.ASSISTANT,
          content: '',
          inputHash,
          status: ConversationMessageStatus.PENDING,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'ConversationAnswerRequested',
          aggregateType: 'Conversation',
          aggregateId: conversation.id,
          payload: { conversationMessageId: assistant.id },
        },
      });
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { lastInteractionAt: new Date() },
      });
      await transaction.inboundMessage.update({
        where: { id: inbound.id },
        data: {
          status: InboundMessageStatus.COMPLETED,
          processedAt: new Date(),
          identityId: identity!.id,
          conversationId: conversation.id,
          conversationMessageId: assistant.id,
        },
      });
      await this.audit('WHATSAPP_INBOUND_RECEIVED', 'InboundMessage', inbound.id, requestId, {
        instance: dto.instance,
        phoneHash,
        conversationId: conversation.id,
        characterCount: dto.text.trim().length,
      });
      await this.sessions.touch(dto.instance, identity!.id, { conversationId: conversation.id });
      return {
        accepted: true,
        pending: true,
        inboundMessageId: inbound.id,
        conversationId: conversation.id,
      };
    });
  }

  /** Pending-answer context for the operational panel (no message content). */
  async identityOverview() {
    const [identities, pendingCount] = await Promise.all([
      this.prisma.whatsappIdentity.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          councilor: {
            select: {
              displayName: true,
              active: true,
              user: { select: { id: true, status: true } },
            },
          },
        },
      }),
      this.prisma.conversationMessage.count({
        where: {
          status: ConversationMessageStatus.PENDING,
          conversation: { channel: ConversationChannel.WHATSAPP },
        },
      }),
    ]);
    const items = await Promise.all(
      identities.map(async (identity) => ({
        id: identity.id,
        phoneMasked: maskPhone(identity.phoneNumber),
        instance: identity.instance,
        active: identity.active,
        verifiedAt: identity.verifiedAt,
        councilor: identity.councilor,
        lastInteraction: await this.sessionLastInteraction(identity),
      })),
    );
    return { items, pendingAnswers: pendingCount };
  }

  private async sessionLastInteraction(
    identity: Pick<WhatsappIdentity, 'id' | 'phoneNumber' | 'instance'>,
  ): Promise<string | null> {
    const raw = await this.redis.client
      .get(whatsappSessionKey(identity.instance, identity.id))
      .catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { lastInteraction?: string };
      return parsed.lastInteraction ?? null;
    } catch {
      return null;
    }
  }

  private async assertRateLimit(instance: string, phone: string): Promise<void> {
    const limit = this.config.getOrThrow<number>('WHATSAPP_RATE_LIMIT');
    const key = `whatsapp:rate:${instance}:${phoneFingerprint(phone)}`;
    const current = await this.redis.client.incr(key).catch(() => 0);
    if (current === 1) await this.redis.client.expire(key, 60).catch(() => undefined);
    if (current > limit) {
      throw new UnauthorizedException('Limite de mensagens por telefone excedido.');
    }
  }

  private async findIdentity(instance: string, phone: string) {
    return this.prisma.whatsappIdentity.findFirst({
      where: { instance, phoneNumber: phone },
      include: identityInclude,
    });
  }

  private evaluateIdentity(identity: ResolvedIdentity | null): string | 'OK' {
    if (!identity) return 'UNKNOWN_NUMBER';
    if (!identity.active) return 'INACTIVE_IDENTITY';
    if (!identity.verifiedAt) return 'UNVERIFIED_IDENTITY';
    if (!identity.councilor.active) return 'INACTIVE_COUNCILOR';
    if (!identity.councilor.userId || !identity.councilor.user) return 'NO_USER';
    if (identity.councilor.user.status !== UserStatus.ACTIVE) return 'INACTIVE_USER';
    return 'OK';
  }

  private async findOrCreateConversation(
    transaction: Prisma.TransactionClient,
    identityId: string,
    userId: string,
  ) {
    const existing = await transaction.conversation.findFirst({
      where: { whatsappIdentityId: identityId, channel: ConversationChannel.WHATSAPP },
      orderBy: { lastInteractionAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing;
    return transaction.conversation.create({
      data: {
        userId,
        channel: ConversationChannel.WHATSAPP,
        whatsappIdentityId: identityId,
        title: 'Conversa WhatsApp',
      },
      select: { id: true },
    });
  }

  private async createNeutralReplyNotification(
    transaction: Prisma.TransactionClient,
    inboundId: string,
    dto: WhatsappInboundDto,
    phone: string,
  ) {
    const neutralReply = await this.loadNeutralReply(transaction);
    const idempotencyKey = `whatsapp-deny:${dto.instance}:${dto.messageId}`;
    const existing = await transaction.notification.findUnique({ where: { idempotencyKey } });
    if (existing) return;
    await transaction.notification.create({
      data: {
        type: 'WHATSAPP_CONVERSATION_REPLY',
        channel: NotificationChannel.WHATSAPP,
        destinationPhone: phone,
        template: WHATSAPP_DENY_TEMPLATE,
        templateVersion: WHATSAPP_DENY_TEMPLATE_VERSION,
        payload: { text: neutralReply, instance: dto.instance } as unknown as Prisma.InputJsonValue,
        idempotencyKey,
        status: NotificationStatus.PENDING,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'NotificationCreated',
        aggregateType: 'InboundMessage',
        aggregateId: inboundId,
        payload: { inboundMessageId: inboundId },
      },
    });
  }

  private async loadNeutralReply(transaction: Prisma.TransactionClient): Promise<string> {
    const setting = await transaction.systemSetting.findUnique({
      where: { key: 'whatsapp.neutralReply' },
    });
    if (!setting) return DEFAULT_NEUTRAL_REPLY;
    const value = setting.value as unknown;
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_NEUTRAL_REPLY;
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

function computeInboundPayloadHash(payload: {
  messageId: string;
  phone: string;
  text: string;
  timestamp: string;
  instance: string;
  metadata: Record<string, unknown>;
}): string {
  const canonical = JSON.stringify(sortKeys(payload));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}
