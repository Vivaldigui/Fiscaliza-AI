import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationChannel,
  ConversationMessageStatus,
  DocumentSecurityStatus,
  MessageRole,
  Prisma,
  type PrismaClient,
} from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrismaService } from '../database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage.service';
import { RedisService } from '../infrastructure/redis.service';
import { CreateConversationDto, SendMessageDto } from './dto/conversation.dto';

interface MessageSource {
  documentId: string;
  documentPageId: string;
  pageNumber: number;
  excerpt?: string;
}

const conversationViewInclude = {
  proposition: { select: { id: true, type: true, number: true, year: true } },
  messages: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ConversationInclude;

const conversationSummaryInclude = {
  proposition: { select: { id: true, type: true, number: true, year: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { content: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.ConversationInclude;

/**
 * Web conversations (Fase 5A).
 *
 * Deny-by-default: every route resolves the conversation against the calling
 * user (ownership) and, when a proposition context exists, re-checks the
 * proposition readable scope. Document downloads are scoped to sources that
 * were persisted on the conversation's own messages after validation — a
 * document never becomes reachable merely because it exists in the tenant.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly redis: RedisService,
    private readonly storage: ObjectStorageService,
    private readonly config: ConfigService,
  ) {}

  async list(user: AuthenticatedUser) {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId: user.id, channel: ConversationChannel.WEB },
      orderBy: { lastInteractionAt: 'desc' },
      take: 50,
      include: conversationSummaryInclude,
    });
    const activeConversationId = await this.activeConversationId(user.id);
    return {
      items: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        propositionId: conversation.propositionId,
        proposition: conversation.proposition,
        lastInteractionAt: conversation.lastInteractionAt,
        createdAt: conversation.createdAt,
        messageCount: conversation._count.messages,
        lastMessage: conversation.messages[0]?.content ?? null,
      })),
      activeConversationId,
    };
  }

  async create(dto: CreateConversationDto, user: AuthenticatedUser, requestId?: string) {
    if (dto.propositionId) {
      await this.assertReadableProposition(dto.propositionId, user);
    }
    const conversation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.conversation.create({
        data: {
          userId: user.id,
          channel: ConversationChannel.WEB,
          title: dto.title?.trim() || this.defaultTitle(),
          propositionId: dto.propositionId ?? null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CONVERSATION_CREATED',
          resourceType: 'Conversation',
          resourceId: created.id,
          requestId,
          newState: {
            channel: 'WEB',
            propositionId: dto.propositionId ?? null,
          },
        },
      });
      return created;
    });
    await this.touchSession(user.id, conversation.id);
    return this.get(conversation.id, user);
  }

  async get(id: string, user: AuthenticatedUser) {
    const conversation = await this.assertOwned(id, user);
    if (conversation.propositionId) {
      await this.assertReadableProposition(conversation.propositionId, user);
    }
    await this.touchSession(user.id, id);
    const full = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationViewInclude,
    });
    return this.toView(full);
  }

  /**
   * Creates the user message and a PENDING assistant placeholder in one
   * transaction, then requests the asynchronous answer through the outbox.
   * Message deduplication is the database unique index
   * `(conversationId, role, inputHash)` — resending the same text after a
   * network retry does not enqueue a second job.
   */
  async sendMessage(id: string, dto: SendMessageDto, user: AuthenticatedUser, requestId?: string) {
    const conversation = await this.assertOwned(id, user);
    if (conversation.propositionId) {
      await this.assertReadableProposition(conversation.propositionId, user);
    }
    const content = dto.content.trim();
    if (!content) throw new ConflictException('Mensagem vazia.');
    const inputHash = createHash('sha256').update(content).digest('hex');
    const existing = await this.prisma.conversationMessage.findFirst({
      where: { conversationId: id, role: MessageRole.USER, inputHash },
      select: { id: true },
    });
    if (existing) {
      await this.touchSession(user.id, id);
      return this.get(id, user);
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.conversationMessage.create({
        data: {
          conversationId: id,
          role: MessageRole.USER,
          content,
          inputHash,
        },
      });
      const assistant = await transaction.conversationMessage.create({
        data: {
          conversationId: id,
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
          aggregateId: id,
          payload: { conversationMessageId: assistant.id },
        },
      });
      await transaction.conversation.update({
        where: { id },
        data: { lastInteractionAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CONVERSATION_MESSAGE_SENT',
          resourceType: 'Conversation',
          resourceId: id,
          requestId,
          metadata: { inputHash, characterCount: content.length },
        },
      });
    });
    await this.touchSession(user.id, id);
    return this.get(id, user);
  }

  /**
   * Signed download URL for a document cited as a source in this conversation.
   * The allowlist is the persisted (post-validation) source list of the
   * conversation's messages — access never falls back to "document exists",
   * and never crosses into documents of other propositions.
   */
  async downloadSource(
    id: string,
    documentId: string,
    user: AuthenticatedUser,
    requestId?: string,
  ) {
    const conversation = await this.assertOwned(id, user);
    if (conversation.propositionId) {
      await this.assertReadableProposition(conversation.propositionId, user);
    }
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.securityStatus !== DocumentSecurityStatus.CLEAN) {
      throw new NotFoundException('Documento não encontrado ou indisponível.');
    }
    const cited = await this.isCitedOnConversation(id, documentId, this.prisma);
    if (!cited) {
      throw new ForbiddenException('Documento não faz parte desta conversa.');
    }
    const ttlSeconds = this.config.getOrThrow<number>('SIGNED_URL_TTL_SECONDS');
    const url = await this.storage.createSignedDownloadUrl(
      document.storageKey,
      document.originalName,
      ttlSeconds,
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CONVERSATION_DOCUMENT_DOWNLOAD',
        resourceType: 'Conversation',
        resourceId: id,
        requestId,
        metadata: { documentId, ttlSeconds },
      },
    });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() };
  }

  private async assertOwned(id: string, user: AuthenticatedUser) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    if (conversation.userId !== user.id) {
      throw new ForbiddenException('Você não possui acesso a esta conversa.');
    }
    return conversation;
  }

  private async assertReadableProposition(propositionId: string, user: AuthenticatedUser) {
    const proposition = await this.prisma.proposition.findUnique({
      where: { id: propositionId },
      include: { authors: { select: { councilorId: true } } },
    });
    if (!proposition) throw new NotFoundException('Proposição não encontrada.');
    const authorCouncilorIds = proposition.authors.map(({ councilorId }) => councilorId);
    if (!this.authorization.canReadProposition(user, authorCouncilorIds)) {
      throw new ForbiddenException('Você não possui acesso a esta proposição.');
    }
    return proposition;
  }

  /** Deny-by-default: a document is downloadable only if it appears as a source of the conversation. */
  private async isCitedOnConversation(
    conversationId: string,
    documentId: string,
    prisma: PrismaClient | Prisma.TransactionClient,
  ): Promise<boolean> {
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId, sources: { not: Prisma.DbNull } },
      select: { sources: true },
    });
    return messages.some(({ sources }) =>
      Array.isArray(sources)
        ? sources.some(
            (source) =>
              typeof source === 'object' &&
              source !== null &&
              (source as unknown as MessageSource).documentId === documentId,
          )
        : false,
    );
  }

  /**
   * The Redis session is only an "active conversation" hint. A failure in the
   * session store must not block the chat itself (the durable state lives in
   * PostgreSQL). Sessions degrade silently: without a hint the web app simply
   * shows the conversation list.
   */
  private async activeConversationId(userId: string): Promise<string | null> {
    let stored: string | null;
    try {
      stored = await this.redis.client.get(`conversation:web:${userId}`);
    } catch {
      return null;
    }
    if (!stored) return null;
    const owned = await this.prisma.conversation.findFirst({
      where: { id: stored, userId },
      select: { id: true },
    });
    return owned?.id ?? null;
  }

  private async touchSession(userId: string, conversationId: string): Promise<void> {
    const ttlSeconds = this.config.getOrThrow<number>('CONVERSATION_SESSION_TTL_SECONDS');
    await this.redis.client
      .set(`conversation:web:${userId}`, conversationId, 'EX', ttlSeconds)
      .catch(() => undefined);
  }

  private toView(
    conversation: Prisma.ConversationGetPayload<{ include: typeof conversationViewInclude }>,
  ) {
    return {
      id: conversation.id,
      title: conversation.title,
      propositionId: conversation.propositionId,
      proposition: conversation.proposition,
      lastInteractionAt: conversation.lastInteractionAt,
      createdAt: conversation.createdAt,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        sources: this.normalizeSources(message.sources),
        provider: message.provider,
        model: message.model,
        answerVersion: message.answerVersion,
        failureReason: message.failureReason,
        latencyMs: message.latencyMs,
        createdAt: message.createdAt,
      })),
    };
  }

  private normalizeSources(sources: Prisma.JsonValue | null): MessageSource[] {
    if (!Array.isArray(sources)) return [];
    const result: MessageSource[] = [];
    for (const value of sources) {
      if (typeof value !== 'object' || value === null) continue;
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.documentId !== 'string' ||
        typeof candidate.documentPageId !== 'string' ||
        typeof candidate.pageNumber !== 'number'
      ) {
        continue;
      }
      result.push({
        documentId: candidate.documentId,
        documentPageId: candidate.documentPageId,
        pageNumber: candidate.pageNumber,
        ...(typeof candidate.excerpt === 'string' ? { excerpt: candidate.excerpt } : {}),
      });
    }
    return result;
  }

  private defaultTitle(): string {
    return `Conversa ${new Date().toLocaleDateString('pt-BR')}`;
  }
}
