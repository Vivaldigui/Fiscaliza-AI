import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthenticatedUser) {
    const propositionWhere: Prisma.PropositionWhereInput = user.roles.includes('COUNCILOR')
      ? { authorId: user.councilorId ?? '__no_councilor__' }
      : {};
    const responseWhere: Prisma.ResponseWhereInput = { proposition: propositionWhere };
    const deadlineWhere: Prisma.DeadlineWhereInput = { proposition: propositionWhere };
    const [requests, indications, awaitingResponse, analyzedResponses, dueSoon, overdue] =
      await this.prisma.$transaction([
        this.prisma.proposition.count({ where: { ...propositionWhere, type: 'REQUEST' } }),
        this.prisma.proposition.count({ where: { ...propositionWhere, type: 'INDICATION' } }),
        this.prisma.proposition.count({
          where: { ...propositionWhere, status: { in: ['ACTIVE', 'AWAITING_RESPONSE'] } },
        }),
        this.prisma.response.count({ where: { ...responseWhere, status: 'ANALYZED' } }),
        this.prisma.deadline.count({ where: { ...deadlineWhere, status: 'DUE_SOON' } }),
        this.prisma.deadline.count({ where: { ...deadlineWhere, status: 'OVERDUE' } }),
      ]);
    return { requests, indications, awaitingResponse, analyzedResponses, dueSoon, overdue };
  }
}
