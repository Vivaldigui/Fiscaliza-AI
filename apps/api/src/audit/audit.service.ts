import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fiscaliza/database';
import { PrismaService } from '../database/prisma.service';

export interface AuditEntry {
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({ data: entry });
  }
}
