import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { whatsappSessionKey, type WhatsappSession } from '@fiscaliza/shared';
import { RedisService } from '../../infrastructure/redis.service';

/**
 * Short-lived WhatsApp session stored in Redis (`whatsapp:session:{instance}:{identityId}`).
 *
 * The session is only a context hint (active proposition + conversation). The
 * durable state lives in PostgreSQL; Redis failures degrade silently — a user
 * can always ask for a new proposition explicitly.
 */
@Injectable()
export class WhatsappSessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private ttlSeconds(): number {
    return this.config.getOrThrow<number>('WHATSAPP_SESSION_TTL_SECONDS');
  }

  async get(instance: string, identityId: string): Promise<WhatsappSession | null> {
    try {
      const raw = await this.redis.client.get(whatsappSessionKey(instance, identityId));
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

  async touch(
    instance: string,
    identityId: string,
    session: Partial<WhatsappSession>,
  ): Promise<void> {
    const current = await this.get(instance, identityId);
    const next: WhatsappSession = {
      activePropositionId: session.activePropositionId ?? current?.activePropositionId ?? null,
      conversationId: session.conversationId ?? current?.conversationId ?? null,
      lastInteraction: new Date().toISOString(),
    };
    await this.redis.client
      .set(whatsappSessionKey(instance, identityId), JSON.stringify(next), 'EX', this.ttlSeconds())
      .catch(() => undefined);
  }

  async clear(instance: string, identityId: string): Promise<void> {
    await this.redis.client.del(whatsappSessionKey(instance, identityId)).catch(() => undefined);
  }
}
