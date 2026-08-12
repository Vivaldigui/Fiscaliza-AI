import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fiscaliza/database';
import { maskPhone } from '@fiscaliza/shared';
import { PrismaService } from '../../database/prisma.service';

/**
 * Administrative operations over WhatsApp identities (Fase 5B). Phones are
 * never returned in full to the frontend — only a masked representation.
 */
@Injectable()
export class WhatsappIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const identities = await this.prisma.whatsappIdentity.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: {
        councilor: {
          select: {
            id: true,
            displayName: true,
            active: true,
            user: { select: { id: true, email: true, status: true } },
          },
        },
        _count: { select: { conversations: true, notifications: true } },
      },
    });
    return identities.map((identity) => ({
      id: identity.id,
      phoneMasked: maskPhone(identity.phoneNumber),
      instance: identity.instance,
      active: identity.active,
      verifiedAt: identity.verifiedAt,
      createdAt: identity.createdAt,
      councilor: identity.councilor,
      conversationCount: identity._count.conversations,
      notificationCount: identity._count.notifications,
    }));
  }

  async verify(id: string, actorId: string) {
    const identity = await this.load(id);
    const updated = await this.prisma.whatsappIdentity.update({
      where: { id },
      data: { verifiedAt: new Date(), active: true },
    });
    await this.audit('WHATSAPP_IDENTITY_VERIFIED', id, actorId, {
      instance: identity.instance,
      phoneHash: identity.phoneNumber.slice(-4),
    });
    return { id: updated.id, verifiedAt: updated.verifiedAt, active: updated.active };
  }

  async deactivate(id: string, actorId: string) {
    const identity = await this.load(id);
    const updated = await this.prisma.whatsappIdentity.update({
      where: { id },
      data: { active: false },
    });
    await this.audit('WHATSAPP_IDENTITY_DEACTIVATED', id, actorId, {
      instance: identity.instance,
      phoneHash: identity.phoneNumber.slice(-4),
    });
    return { id: updated.id, active: updated.active };
  }

  private async load(id: string) {
    const identity = await this.prisma.whatsappIdentity.findUnique({ where: { id } });
    if (!identity) throw new NotFoundException('Identidade WhatsApp não encontrada.');
    return identity;
  }

  private audit(
    action: string,
    resourceId: string,
    actorId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: 'WhatsappIdentity',
        resourceId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
