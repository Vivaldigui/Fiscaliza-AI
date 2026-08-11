import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalysisType, Prisma, PropositionType } from '@fiscaliza/database';
import {
  ANALYSIS_VERSION,
  SCHEMA_VERSION,
  computeInputHash,
  indicationAnalysisPromptV1,
  requestAnalysisPromptV1,
} from '@fiscaliza/ai';
import { PrismaService } from '../database/prisma.service';
import type { ReviewAnalysisItemDto } from './dto/analysis.dto';

const analysisDetailInclude = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      requestedItem: true,
      evidences: { include: { documentPage: { select: { id: true, pageNumber: true } } } },
      revisions: {
        orderBy: { createdAt: 'asc' as const },
        include: { changedBy: { select: { id: true, name: true } } },
      },
    },
  },
  inputDocuments: { include: { document: { select: { id: true, originalName: true } } } },
  aiUsage: true,
} satisfies Prisma.AnalysisInclude;

@Injectable()
export class AnalysesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(propositionId: string, actorId: string) {
    if (!this.config.get<boolean>('AI_PROCESSING_ENABLED')) {
      throw new ServiceUnavailableException(
        'Processamento por IA desabilitado (AI_PROCESSING_ENABLED=false). Nenhuma análise foi executada.',
      );
    }
    const proposition = await this.prisma.proposition.findUnique({
      where: { id: propositionId },
      include: {
        documents: { include: { document: { select: { id: true, processingAttempt: true } } } },
        responses: {
          include: {
            documents: { include: { document: { select: { id: true, processingAttempt: true } } } },
          },
        },
      },
    });
    if (!proposition) throw new NotFoundException('Proposição não encontrada.');

    const provider = this.config.getOrThrow<string>('LLM_PROVIDER');
    const promptVersion =
      proposition.type === PropositionType.REQUEST
        ? requestAnalysisPromptV1.version
        : indicationAnalysisPromptV1.version;
    const documentKeys = proposition.responses
      .flatMap((response) => response.documents.map((link) => link.document))
      .map((document) => `${document.id}:${document.processingAttempt}`)
      .sort();
    const inputHash = computeInputHash([
      proposition.type === PropositionType.REQUEST ? 'request-response' : 'indication-response',
      propositionId,
      ...documentKeys,
      promptVersion,
      SCHEMA_VERSION,
      provider,
      this.config.get<string>('LLM_MODEL') ?? '',
    ]);

    const existing = await this.prisma.analysis.findUnique({
      where: { inputHash },
      include: analysisDetailInclude,
    });
    if (existing) return existing;

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const analysis = await transaction.analysis.create({
          data: {
            propositionId,
            type:
              proposition.type === PropositionType.REQUEST
                ? AnalysisType.REQUEST_RESPONSE
                : AnalysisType.INDICATION_RESPONSE,
            status: 'PENDING',
            provider,
            model: this.config.get<string>('LLM_MODEL') ?? '',
            promptVersion,
            analysisVersion: ANALYSIS_VERSION,
            inputHash,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'ANALYSIS_REQUESTED',
            resourceType: 'Analysis',
            resourceId: analysis.id,
            metadata: { propositionId, type: analysis.type },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: 'AnalysisRequested',
            aggregateType: 'Analysis',
            aggregateId: analysis.id,
            payload: { analysisId: analysis.id, inputHash },
          },
        });
        return analysis;
      });
      return this.get(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.prisma.analysis.findUnique({
          where: { inputHash },
          include: analysisDetailInclude,
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  list(propositionId: string, limit: number) {
    return this.prisma.analysis.findMany({
      where: {
        propositionId,
        type: { in: [AnalysisType.REQUEST_RESPONSE, AnalysisType.INDICATION_RESPONSE] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { items: true, evidences: true } },
      },
    });
  }

  async get(id: string) {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id },
      include: analysisDetailInclude,
    });
    if (!analysis) throw new NotFoundException('Análise não encontrada.');
    return analysis;
  }

  async reanalyze(id: string, actorId: string) {
    const analysis = await this.prisma.analysis.findUnique({ where: { id } });
    if (!analysis) throw new NotFoundException('Análise não encontrada.');
    return this.create(analysis.propositionId, actorId);
  }

  async review(analysisId: string, dto: ReviewAnalysisItemDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.analysisItem.findUnique({ where: { id: dto.analysisItemId } });
      if (!item || item.analysisId !== analysisId) {
        throw new NotFoundException('Item de análise não encontrado.');
      }
      const updated = await transaction.analysisItem.update({
        where: { id: item.id },
        data: {
          currentStatus: dto.newStatus,
          currentExplanation: dto.newExplanation,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewReason: dto.justification,
        },
      });
      await transaction.analysisRevision.create({
        data: {
          analysisItemId: item.id,
          changedById: actorId,
          previousStatus: item.currentStatus,
          newStatus: dto.newStatus,
          previousExplanation: item.currentExplanation,
          newExplanation: dto.newExplanation,
          justification: dto.justification,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'ANALYSIS_ITEM_REVIEWED',
          resourceType: 'AnalysisItem',
          resourceId: item.id,
          previousState: { status: item.currentStatus, explanation: item.currentExplanation },
          newState: { status: dto.newStatus, explanation: dto.newExplanation },
          metadata: { analysisId, justification: dto.justification },
        },
      });
      return updated;
    });
  }
}
