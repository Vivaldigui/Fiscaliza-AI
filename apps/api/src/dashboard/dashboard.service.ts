import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthenticatedUser) {
    const propositionWhere: Prisma.PropositionWhereInput = user.roles.includes('COUNCILOR')
      ? { authors: { some: { councilorId: user.councilorId ?? '__no_councilor__' } } }
      : {};
    const responseWhere: Prisma.ResponseWhereInput = { proposition: propositionWhere };
    const deadlineWhere: Prisma.DeadlineWhereInput = { proposition: propositionWhere };
    const today = new Date(
      `${new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())}T00:00:00.000Z`,
    );
    const [
      requests,
      indications,
      awaitingResponse,
      responsesReceived,
      dueToday,
      dueSoon,
      overdue,
      pendingAssociations,
    ] = await this.prisma.$transaction([
      this.prisma.proposition.count({ where: { ...propositionWhere, type: 'REQUEST' } }),
      this.prisma.proposition.count({ where: { ...propositionWhere, type: 'INDICATION' } }),
      this.prisma.proposition.count({
        where: { ...propositionWhere, status: { in: ['ACTIVE', 'AWAITING_RESPONSE'] } },
      }),
      this.prisma.response.count({ where: { ...responseWhere, status: 'ASSOCIATED' } }),
      this.prisma.deadline.count({
        where: {
          ...deadlineWhere,
          currentDueDate: today,
          status: { in: ['OPEN', 'DUE_SOON', 'EXTENDED'] },
        },
      }),
      this.prisma.deadline.count({ where: { ...deadlineWhere, status: 'DUE_SOON' } }),
      this.prisma.deadline.count({ where: { ...deadlineWhere, status: 'OVERDUE' } }),
      this.prisma.response.count({
        where: { ...responseWhere, propositionId: null, status: 'NEEDS_REVIEW' },
      }),
    ]);
    return {
      requests,
      indications,
      awaitingResponse,
      responsesReceived,
      dueToday,
      dueSoon,
      overdue,
      pendingAssociations,
    };
  }
}
