import type { PrismaClient } from '@fiscaliza/database';
import type Redis from 'ioredis';
import { whatsappSessionKey, type RoleCodeValue, type WhatsappSession } from '@fiscaliza/shared';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';

const BROAD_READ_ROLES: RoleCodeValue[] = ['ADMIN', 'SECRETARIAT', 'AUDITOR'];

export interface WhatsappContextResolution {
  kind: 'context-activated' | 'clarification' | 'not-found' | 'no-op';
  text?: string;
}

interface ResolverParams {
  conversationId: string;
  userId: string;
  propositionId: string | null;
  whatsappIdentityId: string | null;
  instance: string | null;
  question: string;
}

const TYPE_LABEL: Record<string, string> = {
  REQUEST: 'Requerimento',
  INDICATION: 'Indicação',
};

const SELECTION_PATTERN =
  /(requerimento|requerimentos|req\.?|indicacao|indicacoes|indicacaeo|indicação|indicações|ind\.?)\s*(?:n[º°]|#|n)?\s*(\d{1,6})\s*(?:[/-]\s*(\d{4})|de\s+(\d{4}))?/i;

/**
 * Natural-language proposition selection for WhatsApp conversations.
 *
 * - "requerimento 38/2026" / "indicação 12/2026" resolves ONLY among
 *   propositions the user is authorized to read; exactly one match activates
 *   the context (updates the conversation + Redis session); more than one asks
 *   for clarification (never silently picks); none is answered explicitly.
 * - The short Redis session (activePropositionId/conversationId) is restored
 *   when still authorized.
 * - No hard-coded menu; non-selection questions flow through the existing
 *   structured-answer + authorized RAG pipeline.
 */
export class WhatsappContextResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  async resolve(params: ResolverParams): Promise<WhatsappContextResolution> {
    const match = SELECTION_PATTERN.exec(params.question);
    if (!match || match[2] === undefined) {
      return this.restoreSession(params);
    }
    const requestedType = this.typeFromPattern(match[1]!);
    const number = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3] ?? match[4] ?? `${new Date().getFullYear()}`, 10);

    const candidates = await this.findAuthorizedCandidates(
      params.userId,
      requestedType,
      number,
      year,
    );
    if (candidates.length === 0) {
      return { kind: 'not-found' };
    }
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      const instance = params.instance ?? '';
      if (params.whatsappIdentityId) {
        await this.touchSession(instance, params.whatsappIdentityId, {
          activePropositionId: candidate.id,
          conversationId: params.conversationId,
        });
      }
      await this.prisma.conversation.updateMany({
        where: { id: params.conversationId, whatsappIdentityId: params.whatsappIdentityId },
        data: { propositionId: candidate.id, lastInteractionAt: new Date() },
      });
      this.logger.info('Contexto WhatsApp ativado.', {
        conversationId: params.conversationId,
        propositionId: candidate.id,
        stage: 'whatsapp-context',
      });
      return {
        kind: 'context-activated',
        text: `Contexto ativado: ${TYPE_LABEL[candidate.type]} ${candidate.number}/${candidate.year}. O que você quer saber sobre ele?`,
      };
    }
    const list = candidates
      .map(
        (candidate, index) =>
          `(${index + 1}) ${TYPE_LABEL[candidate.type]} ${candidate.number}/${candidate.year}${candidate.subject ? ` — ${candidate.subject}` : ''}`,
      )
      .join('\n');
    return {
      kind: 'clarification',
      text: `Encontrei mais de um registro com esses dados. Qual você quer?\n${list}`,
    };
  }

  private async restoreSession(params: ResolverParams): Promise<WhatsappContextResolution> {
    if (!params.whatsappIdentityId || !params.instance) return { kind: 'no-op' };
    if (params.propositionId) return { kind: 'no-op' };
    const session = await this.readSession(params.instance, params.whatsappIdentityId);
    if (!session?.activePropositionId) return { kind: 'no-op' };
    const authorized = await this.canReadProposition(params.userId, session.activePropositionId);
    if (!authorized) return { kind: 'no-op' };
    await this.prisma.conversation.updateMany({
      where: { id: params.conversationId, whatsappIdentityId: params.whatsappIdentityId },
      data: { propositionId: session.activePropositionId, lastInteractionAt: new Date() },
    });
    await this.touchSession(params.instance, params.whatsappIdentityId, {
      activePropositionId: session.activePropositionId,
      conversationId: params.conversationId,
    });
    return { kind: 'no-op' };
  }

  private async findAuthorizedCandidates(
    userId: string,
    type: 'REQUEST' | 'INDICATION',
    number: number,
    year: number,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        councilor: { select: { id: true } },
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!user) return [];
    const codes = user.roles.map(({ role }) => role.code);
    if (codes.some((code) => BROAD_READ_ROLES.includes(code as RoleCodeValue))) {
      return this.prisma.proposition.findMany({
        where: { type, number, year },
        select: { id: true, type: true, number: true, year: true, subject: true },
        orderBy: { createdAt: 'asc' },
      });
    }
    const councilorId = user.councilor?.id ?? null;
    if (councilorId === null || !codes.includes('COUNCILOR')) return [];
    return this.prisma.proposition.findMany({
      where: {
        type,
        number,
        year,
        authors: { some: { councilorId } },
      },
      select: { id: true, type: true, number: true, year: true, subject: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async canReadProposition(userId: string, propositionId: string): Promise<boolean> {
    const proposition = await this.prisma.proposition.findUnique({
      where: { id: propositionId },
      select: { id: true },
    });
    if (!proposition) return false;
    return this.isAuthorizedProposition(userId, propositionId);
  }

  private async isAuthorizedProposition(userId: string, propositionId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        councilor: { select: { id: true } },
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!user) return false;
    const codes = user.roles.map(({ role }) => role.code);
    if (codes.some((code) => BROAD_READ_ROLES.includes(code as RoleCodeValue))) return true;
    const councilorId = user.councilor?.id ?? null;
    if (councilorId === null || !codes.includes('COUNCILOR')) return false;
    const authors = await this.prisma.propositionAuthor.count({
      where: { propositionId, councilorId },
    });
    return authors > 0;
  }

  private typeFromPattern(value: string): 'REQUEST' | 'INDICATION' {
    return /^req|^requer/i.test(value.trim()) ? 'REQUEST' : 'INDICATION';
  }

  private async readSession(instance: string, identityId: string): Promise<WhatsappSession | null> {
    try {
      const raw = await this.redis.get(whatsappSessionKey(instance, identityId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<WhatsappSession>;
      if (typeof parsed.lastInteraction !== 'string') return null;
      return {
        activePropositionId: parsed.activePropositionId ?? null,
        conversationId: parsed.conversationId ?? null,
        lastInteraction: parsed.lastInteraction,
      };
    } catch {
      return null;
    }
  }

  private async touchSession(
    instance: string,
    identityId: string,
    session: Partial<WhatsappSession>,
  ): Promise<void> {
    const current = await this.readSession(instance, identityId);
    const next: WhatsappSession = {
      activePropositionId: session.activePropositionId ?? current?.activePropositionId ?? null,
      conversationId: session.conversationId ?? current?.conversationId ?? null,
      lastInteraction: new Date().toISOString(),
    };
    await this.redis
      .set(
        whatsappSessionKey(instance, identityId),
        JSON.stringify(next),
        'EX',
        this.config.WHATSAPP_SESSION_TTL_SECONDS,
      )
      .catch(() => undefined);
  }
}
