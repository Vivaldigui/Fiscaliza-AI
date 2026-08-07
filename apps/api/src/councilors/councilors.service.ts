import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fiscaliza/database';
import { PrismaService } from '../database/prisma.service';
import type { CreateCouncilorDto } from './dto/create-councilor.dto';
import type { CreateWhatsappIdentityDto } from './dto/create-whatsapp-identity.dto';
import type { UpdateCouncilorDto } from './dto/update-councilor.dto';

@Injectable()
export class CouncilorsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.councilor.findMany({
      orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
      include: {
        whatsappIdentities: { where: { active: true } },
        user: { select: { email: true } },
      },
    });
  }

  async get(id: string) {
    const councilor = await this.prisma.councilor.findUnique({
      where: { id },
      include: {
        whatsappIdentities: true,
        user: { select: { id: true, email: true, status: true } },
      },
    });
    if (!councilor) throw new NotFoundException('Vereador não encontrado.');
    return councilor;
  }

  create(dto: CreateCouncilorDto, actorId: string) {
    const data = createCouncilorData(dto);
    return this.prisma.$transaction(async (transaction) => {
      const councilor = await transaction.councilor.create({ data });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'COUNCILOR_CREATED',
          resourceType: 'Councilor',
          resourceId: councilor.id,
          newState: { displayName: councilor.displayName, active: councilor.active },
        },
      });
      return councilor;
    });
  }

  async update(id: string, dto: UpdateCouncilorDto, actorId: string) {
    const previous = await this.get(id);
    const data = updateCouncilorData(dto);
    return this.prisma.$transaction(async (transaction) => {
      const councilor = await transaction.councilor.update({ where: { id }, data });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'COUNCILOR_UPDATED',
          resourceType: 'Councilor',
          resourceId: id,
          previousState: { displayName: previous.displayName, active: previous.active },
          newState: { displayName: councilor.displayName, active: councilor.active },
        },
      });
      return councilor;
    });
  }

  async addWhatsappIdentity(id: string, dto: CreateWhatsappIdentityDto, actorId: string) {
    await this.get(id);
    return this.prisma.$transaction(async (transaction) => {
      const identity = await transaction.whatsappIdentity.create({
        data: { councilorId: id, phoneNumber: dto.phoneNumber, instance: dto.instance },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'WHATSAPP_IDENTITY_CREATED',
          resourceType: 'WhatsappIdentity',
          resourceId: identity.id,
          metadata: { councilorId: id, instance: dto.instance },
        },
      });
      return identity;
    });
  }
}

function createCouncilorData(dto: CreateCouncilorDto): Prisma.CouncilorCreateInput {
  return {
    displayName: dto.displayName.trim(),
    ...(dto.legalName !== undefined ? { legalName: dto.legalName.trim() || null } : {}),
    ...(dto.party !== undefined ? { party: dto.party.trim() || null } : {}),
    ...(dto.termStart !== undefined
      ? { termStart: new Date(`${dto.termStart}T00:00:00.000Z`) }
      : {}),
    ...(dto.termEnd !== undefined ? { termEnd: new Date(`${dto.termEnd}T00:00:00.000Z`) } : {}),
    ...(dto.active !== undefined ? { active: dto.active } : {}),
  };
}

function updateCouncilorData(dto: UpdateCouncilorDto): Prisma.CouncilorUpdateInput {
  return {
    ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
    ...(dto.legalName !== undefined ? { legalName: dto.legalName.trim() || null } : {}),
    ...(dto.party !== undefined ? { party: dto.party.trim() || null } : {}),
    ...(dto.termStart !== undefined
      ? { termStart: new Date(`${dto.termStart}T00:00:00.000Z`) }
      : {}),
    ...(dto.termEnd !== undefined ? { termEnd: new Date(`${dto.termEnd}T00:00:00.000Z`) } : {}),
    ...(dto.active !== undefined ? { active: dto.active } : {}),
  };
}
