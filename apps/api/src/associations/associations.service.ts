import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssociationCandidateStatus,
  AssociationEvaluationStatus,
  AssociationMethod,
  DeadlineStatus,
  Prisma,
  PropositionStatus,
  ResponseStatus,
} from '@fiscaliza/database';
import { associationWeightsSchema } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';
import { DeadlinesService } from '../deadlines/deadlines.service';
import { DeterministicAssociationEngine, type AssociationWeights } from './association-engine';
import type { ConfirmAssociationDto, RejectCandidateDto } from './dto/association.dto';

@Injectable()
export class AssociationsService {
  private readonly engine = new DeterministicAssociationEngine();

  constructor(private readonly prisma: PrismaService) {}

  pending() {
    return this.prisma.response.findMany({
      where: { propositionId: null, status: ResponseStatus.NEEDS_REVIEW },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: { include: { document: { select: { id: true, originalName: true } } } },
        associationEvaluations: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            candidates: {
              orderBy: { rank: 'asc' },
              include: { proposition: { include: { authors: { include: { councilor: true } } } } },
            },
          },
        },
      },
    });
  }

  async evaluate(responseId: string) {
    const [response, propositions, settings] = await Promise.all([
      this.prisma.response.findUnique({
        where: { id: responseId },
        include: {
          documents: {
            include: {
              document: {
                include: {
                  pages: { include: { processingAttempt: { select: { attempt: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.proposition.findMany({
        where: { status: { not: PropositionStatus.ARCHIVED } },
        select: {
          id: true,
          type: true,
          number: true,
          year: true,
          protocolNumber: true,
          protocolDate: true,
          subject: true,
        },
      }),
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'association.autoThreshold',
              'association.minimumMargin',
              'association.signalWeights',
            ],
          },
        },
      }),
    ]);
    if (!response) throw new NotFoundException('Resposta não encontrada.');
    const config = parseConfiguration(settings);
    const text = response.documents
      .flatMap(({ document }) =>
        document.pages.filter(
          ({ processingAttempt }) => processingAttempt.attempt === document.processingAttempt,
        ),
      )
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map(({ effectiveText }) => effectiveText)
      .join('\n');
    const scores = this.engine.score(
      {
        text,
        protocolNumber: response.protocolNumber,
        protocolDate: response.protocolDate,
        subject: response.subject,
      },
      propositions,
      config.weights,
    );
    const decision = this.engine.decide(scores, config.minimumScore, config.minimumMargin);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.associationCandidate.updateMany({
        where: { responseId, status: AssociationCandidateStatus.PENDING },
        data: { status: AssociationCandidateStatus.SUPERSEDED },
      });
      const evaluation = await transaction.associationEvaluation.create({
        data: {
          responseId,
          status: decision.needsReview
            ? AssociationEvaluationStatus.NEEDS_REVIEW
            : AssociationEvaluationStatus.AUTO_ASSOCIATED,
          topScore: decision.topScore,
          secondScore: decision.secondScore,
          margin: decision.margin,
          configurationSnapshot: {
            minimumScore: config.minimumScore,
            minimumMargin: config.minimumMargin,
            weights: config.weights,
            reason: decision.reason,
          } as unknown as Prisma.InputJsonValue,
          candidates: {
            create: scores.slice(0, 10).map((score, index) => ({
              responseId,
              propositionId: score.propositionId,
              score: score.score,
              signalScores: { ...score.signals, explanations: score.explanations },
              rank: index + 1,
              status:
                decision.selected?.propositionId === score.propositionId
                  ? AssociationCandidateStatus.ACCEPTED
                  : AssociationCandidateStatus.PENDING,
            })),
          },
        },
        include: { candidates: { orderBy: { rank: 'asc' } } },
      });
      if (!decision.selected) {
        await transaction.response.update({
          where: { id: responseId },
          data: { status: ResponseStatus.NEEDS_REVIEW },
        });
        return evaluation;
      }
      await this.associate(
        transaction,
        responseId,
        decision.selected.propositionId,
        AssociationMethod.AUTOMATIC,
        decision.selected.score,
        null,
        null,
        response.associationVersion,
      );
      return evaluation;
    });
  }

  async confirm(responseId: string, dto: ConfirmAssociationDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const response = await transaction.response.findUnique({ where: { id: responseId } });
      if (!response) throw new NotFoundException('Resposta não encontrada.');
      await this.associate(
        transaction,
        responseId,
        dto.propositionId,
        AssociationMethod.MANUAL,
        null,
        actorId,
        dto.reason,
        dto.expectedVersion,
      );
      await transaction.associationCandidate.updateMany({
        where: {
          responseId,
          propositionId: dto.propositionId,
          status: AssociationCandidateStatus.PENDING,
        },
        data: { status: AssociationCandidateStatus.ACCEPTED },
      });
      await transaction.associationEvaluation.updateMany({
        where: { responseId, status: AssociationEvaluationStatus.NEEDS_REVIEW },
        data: { status: AssociationEvaluationStatus.MANUALLY_RESOLVED },
      });
      return transaction.response.findUniqueOrThrow({
        where: { id: responseId },
        include: { proposition: true, associationRevisions: { orderBy: { createdAt: 'desc' } } },
      });
    });
  }

  async reject(responseId: string, candidateId: string, dto: RejectCandidateDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.associationCandidate.findUnique({
        where: { id: candidateId },
      });
      if (!candidate || candidate.responseId !== responseId)
        throw new NotFoundException('Candidato não encontrado.');
      const response = await transaction.response.updateMany({
        where: { id: responseId, associationVersion: dto.expectedVersion },
        data: { associationVersion: { increment: 1 }, status: ResponseStatus.NEEDS_REVIEW },
      });
      if (response.count !== 1) throw concurrentAssociationError();
      await transaction.associationCandidate.update({
        where: { id: candidateId },
        data: { status: AssociationCandidateStatus.REJECTED },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'RESPONSE_ASSOCIATION_CANDIDATE_REJECTED',
          resourceType: 'AssociationCandidate',
          resourceId: candidateId,
          metadata: { responseId, propositionId: candidate.propositionId, reason: dto.reason },
        },
      });
      return { rejected: true, associationVersion: dto.expectedVersion + 1 };
    });
  }

  private async associate(
    transaction: Prisma.TransactionClient,
    responseId: string,
    propositionId: string,
    method: AssociationMethod,
    confidence: number | null,
    actorId: string | null,
    reason: string | null,
    expectedVersion: number,
  ) {
    const [response, proposition] = await Promise.all([
      transaction.response.findUnique({ where: { id: responseId } }),
      transaction.proposition.findUnique({ where: { id: propositionId } }),
    ]);
    if (!response) throw new NotFoundException('Resposta não encontrada.');
    if (!proposition) throw new NotFoundException('Proposição não encontrada.');
    const changed = await transaction.response.updateMany({
      where: { id: responseId, associationVersion: expectedVersion },
      data: {
        propositionId,
        associationMethod: method,
        associationConfidence: confidence,
        associatedById: actorId,
        associatedAt: new Date(),
        status: ResponseStatus.ASSOCIATED,
        associationVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw concurrentAssociationError();
    await transaction.responseAssociationRevision.create({
      data: {
        responseId,
        previousPropositionId: response.propositionId,
        newPropositionId: propositionId,
        previousMethod: response.associationMethod,
        newMethod: method,
        changedById: actorId,
        reason,
      },
    });
    if (response.propositionId && response.propositionId !== propositionId) {
      await transaction.proposition.update({
        where: { id: response.propositionId },
        data: { status: PropositionStatus.NEEDS_REVIEW },
      });
    }
    await transaction.proposition.update({
      where: { id: propositionId },
      data: { status: PropositionStatus.RESPONSE_RECEIVED },
    });
    const receivedAt = response.protocolDate ?? response.createdAt;
    await transaction.deadline.updateMany({
      where: {
        propositionId,
        status: { notIn: [DeadlineStatus.RESPONDED, DeadlineStatus.RESPONSE_RECEIVED] },
      },
      data: DeadlinesService.responseReceiptData(receivedAt),
    });
    const action =
      method === AssociationMethod.AUTOMATIC
        ? 'RESPONSE_ASSOCIATED_AUTO'
        : response.propositionId && response.propositionId !== propositionId
          ? 'RESPONSE_ASSOCIATION_CHANGED'
          : 'RESPONSE_ASSOCIATED_MANUAL';
    await transaction.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: 'Response',
        resourceId: responseId,
        previousState: {
          propositionId: response.propositionId,
          method: response.associationMethod,
        },
        newState: { propositionId, method, confidence },
        metadata: reason ? { reason } : undefined,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: 'ResponseAssociated',
        aggregateType: 'Response',
        aggregateId: responseId,
        payload: { responseId, propositionId, method },
      },
    });
  }
}

function parseConfiguration(settings: Array<{ key: string; value: Prisma.JsonValue }>) {
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value;
  const minimumScore = value('association.autoThreshold');
  const minimumMargin = value('association.minimumMargin');
  if (typeof minimumScore !== 'number' || typeof minimumMargin !== 'number') {
    throw new ConflictException('Limiares de associação ausentes ou inválidos.');
  }
  return {
    minimumScore,
    minimumMargin,
    weights: associationWeightsSchema.parse(
      value('association.signalWeights'),
    ) as AssociationWeights,
  };
}

function concurrentAssociationError(): ConflictException {
  return new ConflictException(
    'A resposta foi associada ou revisada por outro usuário. Recarregue os dados.',
  );
}
