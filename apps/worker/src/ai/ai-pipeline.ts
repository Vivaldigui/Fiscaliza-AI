import type { PrismaClient, Prisma } from '@fiscaliza/database';
import {
  AiValidationExhaustedError,
  analyzeIndicationResponses,
  analyzeRequestResponses,
  computeInputHash,
  extractIndicationItems,
  extractRequestItems,
  generateExecutiveSummary,
  requestExtractionPromptV1,
  indicationExtractionPromptV1,
  ANALYSIS_VERSION,
  SCHEMA_VERSION,
  type LLMProvider,
  type PipelinePage,
  type UsageEvent,
} from '@fiscaliza/ai';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';
import { excerptExistsOnPage } from './evidence-validator';

const REQUEST_EVIDENCE_REQUIRED = new Set(['ANSWERED', 'PARTIALLY_ANSWERED']);
const INDICATION_EVIDENCE_REQUIRED = new Set([
  'ACCEPTED',
  'REJECTED',
  'UNDER_ANALYSIS',
  'ACTION_REPORTED',
  'EXECUTION_REPORTED',
]);

interface DocumentPageRow {
  id: string;
  documentId: string;
  pageNumber: number;
  effectiveText: string;
}

interface DocumentSource {
  documentId: string;
  documentLabel: string;
  processingAttemptId: string;
  pages: DocumentPageRow[];
}

interface FinalizedItem {
  requestedItemId: string;
  originalStatus: string;
  originalExplanation: string;
  currentStatus: string;
  currentExplanation: string;
  confidence: number;
  evidences: Array<{
    documentId: string;
    documentPageId: string;
    pageNumber: number;
    excerpt?: string;
    reason: string;
  }>;
}

export class AiAnalysisPipeline {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: LLMProvider,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  async process(analysisId: string, jobId: string): Promise<void> {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { proposition: true },
    });
    if (!analysis) {
      this.logger.warn('Análise não encontrada; job obsoleto.', { analysisId, jobId });
      return;
    }
    if (analysis.status !== 'PENDING' && analysis.status !== 'PROCESSING') {
      this.logger.info('Análise já finalizada; job ignorado.', {
        analysisId,
        jobId,
        status: analysis.status,
      });
      return;
    }
    if (!this.config.AI_PROCESSING_ENABLED) {
      await this.fail(
        analysisId,
        'IA desabilitada operacionalmente (AI_PROCESSING_ENABLED=false).',
      );
      return;
    }

    await this.prisma.analysis.updateMany({
      where: { id: analysisId, status: 'PENDING' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    const usage: UsageEvent[] = [];
    try {
      const proposition = analysis.proposition;
      const activeItems = await this.ensureExtraction(
        proposition.id,
        proposition.type,
        jobId,
        usage,
      );
      if (activeItems.length === 0) {
        await this.finalizeWithoutItems(analysisId);
        return;
      }

      const {
        pages: responsePages,
        sources,
        responseIds,
      } = await this.loadResponsePages(proposition.id);
      const thresholds = await this.loadConfidenceThresholds();

      let mergedItems: Array<{
        requestedItemId: string;
        status: string;
        explanation: string;
        confidence: number;
        evidences: Array<{
          documentPageId: string;
          pageNumber: number;
          excerpt?: string;
          reason: string;
        }>;
      }>;

      if (responsePages.length === 0) {
        mergedItems = activeItems.map((item) => ({
          requestedItemId: item.id,
          status: proposition.type === 'REQUEST' ? 'NOT_ANSWERED' : 'NO_CLEAR_POSITION',
          explanation: 'Nenhuma resposta associada a esta proposição até o momento da análise.',
          confidence: 1,
          evidences: [],
        }));
      } else if (proposition.type === 'REQUEST') {
        const result = await analyzeRequestResponses({
          provider: this.provider,
          items: activeItems.map((item) => ({
            id: item.id,
            normalizedQuestion: item.normalizedQuestion,
          })),
          pages: responsePages,
          maxPagesPerBatch: this.config.AI_MAX_PAGES_PER_BATCH,
          maxRetries: this.config.AI_MAX_RETRIES,
        });
        usage.push(...result.usage);
        mergedItems = result.items;
      } else {
        const result = await analyzeIndicationResponses({
          provider: this.provider,
          items: activeItems.map((item) => ({
            id: item.id,
            normalizedQuestion: item.normalizedQuestion,
          })),
          pages: responsePages,
          maxPagesPerBatch: this.config.AI_MAX_PAGES_PER_BATCH,
          maxRetries: this.config.AI_MAX_RETRIES,
        });
        usage.push(...result.usage);
        mergedItems = result.items;
      }

      const pageIndex = new Map(responsePages.map((page) => [page.documentPageId, page]));
      const documentIdByPage = new Map(
        sources.flatMap((source) =>
          source.pages.map((page) => [page.id, source.documentId] as const),
        ),
      );
      const finalized: FinalizedItem[] = mergedItems.map((item) =>
        this.finalizeItem(item, pageIndex, documentIdByPage, proposition.type, thresholds),
      );

      const overallStatus = finalized.some(
        (item) =>
          item.currentStatus === 'NEEDS_HUMAN_REVIEW' || item.currentStatus === 'INCONCLUSIVE',
      )
        ? 'NEEDS_HUMAN_REVIEW'
        : 'COMPLETED';
      const overallConfidence = Math.min(...finalized.map((item) => item.confidence));

      const summaryResult = await generateExecutiveSummary({
        provider: this.provider,
        items: finalized.map((item) => ({
          id: item.requestedItemId,
          question:
            activeItems.find((requested) => requested.id === item.requestedItemId)
              ?.normalizedQuestion ?? '',
          status: item.currentStatus,
          explanation: item.currentExplanation,
          evidenceIds: [],
        })),
        maxRetries: this.config.AI_MAX_RETRIES,
      });
      usage.push(...summaryResult.usage);

      const coverage = {
        responseIds,
        documentIds: [...new Set(sources.map((source) => source.documentId))],
        processingAttemptIds: [...new Set(sources.map((source) => source.processingAttemptId))],
        pageCountScanned: responsePages.length,
        batchCount: Math.max(
          1,
          Math.ceil(responsePages.length / this.config.AI_MAX_PAGES_PER_BATCH),
        ),
        analysisCutoff: new Date().toISOString(),
      };

      await this.persist({
        analysisId,
        analysisType: analysis.type,
        propositionId: proposition.id,
        propositionType: proposition.type,
        finalized,
        overallStatus,
        overallConfidence,
        executiveSummary: summaryResult.summary,
        sources,
        coverage,
        usage,
        inputHash: analysis.inputHash,
      });
      this.logger.info('Análise concluída.', {
        analysisId,
        jobId,
        overallStatus,
        itemCount: finalized.length,
      });
    } catch (error) {
      const message =
        error instanceof AiValidationExhaustedError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Falha desconhecida no processamento de IA.';
      await this.fail(analysisId, message);
      this.logger.error('Falha ao processar análise.', { analysisId, jobId, error: message });
      if (!(error instanceof AiValidationExhaustedError)) throw error;
    }
  }

  private async ensureExtraction(
    propositionId: string,
    propositionType: string,
    jobId: string,
    usage: UsageEvent[],
  ): Promise<Array<{ id: string; normalizedQuestion: string }>> {
    const existingActive = await this.prisma.requestedItem.findMany({
      where: { propositionId, active: true },
      select: { id: true, normalizedQuestion: true },
      orderBy: { sequence: 'asc' },
    });
    if (existingActive.length > 0) return existingActive;

    const { pages, sources } = await this.loadPropositionSourcePages(propositionId);
    if (pages.length === 0) return [];

    const promptVersion =
      propositionType === 'REQUEST'
        ? requestExtractionPromptV1.version
        : indicationExtractionPromptV1.version;
    const inputHash = computeInputHash([
      'extraction',
      propositionId,
      ...sources.map((source) => `${source.documentId}:${source.processingAttemptId}`).sort(),
      promptVersion,
      SCHEMA_VERSION,
      this.provider.name,
      this.provider.model,
    ]);

    const existing = await this.prisma.analysis.findUnique({ where: { inputHash } });
    if (existing?.status === 'COMPLETED') {
      const items = await this.prisma.requestedItem.findMany({
        where: { extractionAnalysisId: existing.id, active: true },
        select: { id: true, normalizedQuestion: true },
        orderBy: { sequence: 'asc' },
      });
      if (items.length > 0) return items;
    }
    if (existing && existing.status !== 'FAILED' && existing.id) {
      this.logger.info('Extração já em andamento em outra execução; nova tentativa mais tarde.', {
        propositionId,
        jobId,
      });
      throw new Error('Extração concorrente em andamento para esta proposição.');
    }

    const extractionAnalysis = existing
      ? await this.prisma.analysis.update({
          where: { id: existing.id },
          data: { status: 'PROCESSING', startedAt: new Date(), failureReason: null },
        })
      : await this.prisma.analysis.create({
          data: {
            propositionId,
            type: propositionType === 'REQUEST' ? 'REQUEST_EXTRACTION' : 'INDICATION_EXTRACTION',
            status: 'PROCESSING',
            provider: this.provider.name,
            model: this.provider.model,
            promptVersion,
            analysisVersion: ANALYSIS_VERSION,
            inputHash,
            startedAt: new Date(),
          },
        });

    try {
      if (propositionType === 'REQUEST') {
        const extraction = await extractRequestItems({
          provider: this.provider,
          pages,
          maxPagesPerBatch: this.config.AI_MAX_PAGES_PER_BATCH,
          maxRetries: this.config.AI_MAX_RETRIES,
        });
        usage.push(...extraction.usage);
        return this.persistExtraction(
          propositionId,
          extractionAnalysis.id,
          sources,
          extraction.items.map((item) => ({
            sequence: item.sequence,
            originalText: item.originalText,
            normalizedQuestion: item.normalizedQuestion,
            category: item.category ?? null,
            expectedAnswerType: item.expectedAnswerType,
            sourcePage: item.sourcePageNumber,
            sourceDocumentPageId: item.sourceDocumentPageId,
            extractionConfidence: item.confidence,
          })),
          extraction.rejectedForInventedPage,
          usage,
        );
      }
      const extraction = await extractIndicationItems({
        provider: this.provider,
        pages,
        maxPagesPerBatch: this.config.AI_MAX_PAGES_PER_BATCH,
        maxRetries: this.config.AI_MAX_RETRIES,
      });
      usage.push(...extraction.usage);
      return this.persistExtraction(
        propositionId,
        extractionAnalysis.id,
        sources,
        extraction.items.map((item) => ({
          sequence: item.sequence,
          originalText: item.originalText,
          normalizedQuestion: item.normalizedQuestion,
          category: item.category ?? null,
          expectedAnswerType: item.expectedAnswerType,
          sourcePage: item.sourcePageNumber,
          sourceDocumentPageId: item.sourceDocumentPageId,
          extractionConfidence: item.confidence,
        })),
        extraction.rejectedForInventedPage,
        usage,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida na extração.';
      await this.prisma.analysis.update({
        where: { id: extractionAnalysis.id },
        data: { status: 'FAILED', failureReason: message, completedAt: new Date() },
      });
      throw error;
    }
  }

  private async persistExtraction(
    propositionId: string,
    extractionAnalysisId: string,
    sources: DocumentSource[],
    items: Array<{
      sequence: number;
      originalText: string;
      normalizedQuestion: string;
      category: string | null;
      expectedAnswerType: string;
      sourcePage: number;
      sourceDocumentPageId: string;
      extractionConfidence: number;
    }>,
    rejectedForInventedPage: number,
    usage: UsageEvent[],
  ): Promise<Array<{ id: string; normalizedQuestion: string }>> {
    const status =
      items.length === 0 || rejectedForInventedPage > 0 ? 'NEEDS_HUMAN_REVIEW' : 'COMPLETED';
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.requestedItem.updateMany({
        where: { propositionId, active: true },
        data: { active: false },
      });
      await transaction.analysisDocument.createMany({
        data: sources.map((source) => ({
          analysisId: extractionAnalysisId,
          documentId: source.documentId,
          processingAttemptId: source.processingAttemptId,
        })),
        skipDuplicates: true,
      });
      const rows = [];
      for (const item of items) {
        const row = await transaction.requestedItem.create({
          data: {
            propositionId,
            extractionAnalysisId,
            active: true,
            sequence: item.sequence,
            originalText: item.originalText,
            normalizedQuestion: item.normalizedQuestion,
            category: item.category,
            expectedAnswerType: item.expectedAnswerType as never,
            sourcePage: item.sourcePage,
            sourceDocumentPageId: item.sourceDocumentPageId,
            extractionConfidence: item.extractionConfidence,
          },
          select: { id: true, normalizedQuestion: true },
        });
        rows.push(row);
      }
      await transaction.analysis.update({
        where: { id: extractionAnalysisId },
        data: {
          status,
          confidence: items.length
            ? Math.min(...items.map((item) => item.extractionConfidence))
            : 0,
          originalResult: { items, rejectedForInventedPage } as unknown as Prisma.InputJsonValue,
          currentResult: { items, rejectedForInventedPage } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      for (const event of usage) {
        await transaction.aIUsage.create({
          data: {
            analysisId: extractionAnalysisId,
            provider: this.provider.name,
            model: this.provider.model,
            operation: event.operation,
            promptVersion: event.operation,
            analysisVersion: ANALYSIS_VERSION,
            inputHash: extractionAnalysisId,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            latencyMs: event.usage.latencyMs,
            cached: false,
          },
        });
      }
      return rows;
    });
    return created;
  }

  private async loadPropositionSourcePages(
    propositionId: string,
  ): Promise<{ pages: PipelinePage[]; sources: DocumentSource[] }> {
    const links = await this.prisma.propositionDocument.findMany({
      where: { propositionId },
      include: {
        document: {
          include: {
            pages: { include: { processingAttempt: { select: { id: true, attempt: true } } } },
          },
        },
      },
      orderBy: [{ role: 'desc' }, { sortOrder: 'asc' }],
    });
    return this.toPagesAndSources(links.map((link) => link.document));
  }

  private async loadResponsePages(
    propositionId: string,
  ): Promise<{ pages: PipelinePage[]; sources: DocumentSource[]; responseIds: string[] }> {
    const responses = await this.prisma.response.findMany({
      where: { propositionId },
      orderBy: [{ protocolDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        documents: {
          include: {
            document: {
              include: {
                pages: { include: { processingAttempt: { select: { id: true, attempt: true } } } },
              },
            },
          },
        },
      },
    });
    const documents = responses.flatMap((response) =>
      response.documents.map((link) => link.document),
    );
    const { pages, sources } = this.toPagesAndSources(documents);
    return { pages, sources, responseIds: responses.map((response) => response.id) };
  }

  private toPagesAndSources(
    documents: Array<{
      id: string;
      originalName: string;
      processingAttempt: number;
      pages: Array<{
        id: string;
        documentId: string;
        pageNumber: number;
        effectiveText: string;
        processingAttempt: { id: string; attempt: number };
      }>;
    }>,
  ): { pages: PipelinePage[]; sources: DocumentSource[] } {
    const pages: PipelinePage[] = [];
    const sources: DocumentSource[] = [];
    const seenDocuments = new Set<string>();
    for (const document of documents) {
      if (seenDocuments.has(document.id)) continue;
      seenDocuments.add(document.id);
      const currentPages = document.pages
        .filter((page) => page.processingAttempt.attempt === document.processingAttempt)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      if (currentPages.length === 0) continue;
      const processingAttemptId = currentPages[0]!.processingAttempt.id;
      sources.push({
        documentId: document.id,
        documentLabel: document.originalName,
        processingAttemptId,
        pages: currentPages.map((page) => ({
          id: page.id,
          documentId: page.documentId,
          pageNumber: page.pageNumber,
          effectiveText: page.effectiveText,
        })),
      });
      for (const page of currentPages) {
        pages.push({
          documentPageId: page.id,
          documentLabel: document.originalName,
          pageNumber: page.pageNumber,
          text: page.effectiveText.slice(0, this.config.AI_MAX_INPUT_CHARS),
        });
      }
    }
    return { pages, sources };
  }

  private async loadConfidenceThresholds(): Promise<{ normal: number; warning: number }> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['analysis.confidence.normal', 'analysis.confidence.warning'] } },
    });
    const value = (key: string) => settings.find((setting) => setting.key === key)?.value;
    const normal = value('analysis.confidence.normal');
    const warning = value('analysis.confidence.warning');
    if (typeof normal !== 'number' || typeof warning !== 'number') {
      throw new Error('Limiares de confiança de análise ausentes ou inválidos.');
    }
    return { normal, warning };
  }

  private finalizeItem(
    item: {
      requestedItemId: string;
      status: string;
      explanation: string;
      confidence: number;
      evidences: Array<{
        documentPageId: string;
        pageNumber: number;
        excerpt?: string;
        reason: string;
      }>;
    },
    pageIndex: Map<string, { documentPageId: string; pageNumber: number; text: string }>,
    documentIdByPage: Map<string, string>,
    propositionType: string,
    thresholds: { normal: number; warning: number },
  ): FinalizedItem {
    const validEvidences = item.evidences
      .filter((evidence) => {
        const page = pageIndex.get(evidence.documentPageId);
        if (!page) return false;
        if (page.pageNumber !== evidence.pageNumber) return false;
        return excerptExistsOnPage(evidence.excerpt, page.text);
      })
      .map((evidence) => ({
        documentId: documentIdByPage.get(evidence.documentPageId) ?? '',
        documentPageId: evidence.documentPageId,
        pageNumber: evidence.pageNumber,
        ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
        reason: evidence.reason,
      }))
      .filter((evidence) => evidence.documentId);

    const requiresEvidence =
      propositionType === 'REQUEST'
        ? REQUEST_EVIDENCE_REQUIRED.has(item.status)
        : INDICATION_EVIDENCE_REQUIRED.has(item.status);

    let currentStatus = item.status;
    let currentExplanation = item.explanation;
    if (requiresEvidence && validEvidences.length === 0) {
      currentStatus = 'NEEDS_HUMAN_REVIEW';
      currentExplanation = `${item.explanation} (evidência apresentada pelo modelo não pôde ser validada contra o texto da página; revisão humana necessária.)`;
    } else if (item.confidence < thresholds.warning) {
      currentStatus = 'NEEDS_HUMAN_REVIEW';
      currentExplanation = `${item.explanation} (confiança abaixo do limiar mínimo; revisão humana necessária.)`;
    }

    return {
      requestedItemId: item.requestedItemId,
      originalStatus: item.status,
      originalExplanation: item.explanation,
      currentStatus,
      currentExplanation,
      confidence: item.confidence,
      evidences: validEvidences,
    };
  }

  private async persist(params: {
    analysisId: string;
    analysisType: string;
    propositionId: string;
    propositionType: string;
    finalized: FinalizedItem[];
    overallStatus: string;
    overallConfidence: number;
    executiveSummary: unknown;
    sources: DocumentSource[];
    coverage: Record<string, unknown>;
    usage: UsageEvent[];
    inputHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.analysisDocument.createMany({
        data: params.sources.map((source) => ({
          analysisId: params.analysisId,
          documentId: source.documentId,
          processingAttemptId: source.processingAttemptId,
        })),
        skipDuplicates: true,
      });
      for (const item of params.finalized) {
        const created = await transaction.analysisItem.create({
          data: {
            analysisId: params.analysisId,
            requestedItemId: item.requestedItemId,
            originalStatus: item.originalStatus as never,
            currentStatus: item.currentStatus as never,
            originalExplanation: item.originalExplanation,
            currentExplanation: item.currentExplanation,
            confidence: item.confidence,
          },
        });
        for (const evidence of item.evidences) {
          await transaction.evidence.create({
            data: {
              analysisId: params.analysisId,
              analysisItemId: created.id,
              documentId: evidence.documentId,
              documentPageId: evidence.documentPageId,
              pageNumber: evidence.pageNumber,
              kind: evidence.excerpt ? 'TEXT' : 'VISUAL_REFERENCE',
              excerpt: evidence.excerpt ?? null,
              reason: evidence.reason,
            },
          });
        }
      }
      await transaction.analysis.update({
        where: { id: params.analysisId },
        data: {
          status: params.overallStatus as never,
          confidence: params.overallConfidence,
          executiveSummary: params.executiveSummary as unknown as Prisma.InputJsonValue,
          originalResult: {
            items: params.finalized,
            coverage: params.coverage,
          } as unknown as Prisma.InputJsonValue,
          currentResult: {
            items: params.finalized,
            coverage: params.coverage,
          } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      for (const event of params.usage) {
        await transaction.aIUsage.create({
          data: {
            analysisId: params.analysisId,
            provider: this.provider.name,
            model: this.provider.model,
            operation: event.operation,
            promptVersion: event.operation,
            analysisVersion: ANALYSIS_VERSION,
            inputHash: params.inputHash,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            latencyMs: event.usage.latencyMs,
            cached: false,
          },
        });
      }
      if (params.overallStatus === 'COMPLETED') {
        const nextStatus = deriveNextPropositionStatus(params.propositionType, params.finalized);
        if (nextStatus) {
          await transaction.proposition.update({
            where: { id: params.propositionId },
            data: { status: nextStatus as never },
          });
        }
      }
      await transaction.outboxEvent.create({
        data: {
          eventType:
            params.overallStatus === 'COMPLETED' ? 'AnalysisCompleted' : 'AnalysisNeedsReview',
          aggregateType: 'Analysis',
          aggregateId: params.analysisId,
          payload: { analysisId: params.analysisId, propositionId: params.propositionId },
        },
      });
      // Evento derivado (Fase 5B): somente análises de RESPOSTA realmente
      // COMPLETED geram contrato para notificação de autores. Extrações,
      // PENDING/PROCESSING/FAILED/NEEDS_HUMAN_REVIEW nunca notificam.
      const isResponseAnalysis =
        params.analysisType === 'REQUEST_RESPONSE' || params.analysisType === 'INDICATION_RESPONSE';
      if (params.overallStatus === 'COMPLETED' && isResponseAnalysis) {
        await transaction.outboxEvent.create({
          data: {
            eventType: 'ResponseAnalysisCompleted',
            aggregateType: 'Analysis',
            aggregateId: params.analysisId,
            payload: { analysisId: params.analysisId, propositionId: params.propositionId },
          },
        });
      }
    });
  }

  private async finalizeWithoutItems(analysisId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'NEEDS_HUMAN_REVIEW',
          failureReason: 'Nenhum item verificável pôde ser extraído com página de origem válida.',
          completedAt: new Date(),
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'AnalysisNeedsReview',
          aggregateType: 'Analysis',
          aggregateId: analysisId,
          payload: { analysisId },
        },
      });
    });
  }

  private async fail(analysisId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.analysis.updateMany({
        where: { id: analysisId },
        data: { status: 'FAILED', failureReason: reason.slice(0, 2000), completedAt: new Date() },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'AnalysisFailed',
          aggregateType: 'Analysis',
          aggregateId: analysisId,
          payload: { analysisId, reason: reason.slice(0, 500) },
        },
      });
    });
  }
}

function deriveNextPropositionStatus(
  propositionType: string,
  items: FinalizedItem[],
): string | null {
  if (propositionType === 'REQUEST') {
    const allResolved = items.every(
      (item) => item.currentStatus === 'ANSWERED' || item.currentStatus === 'NOT_APPLICABLE',
    );
    if (allResolved) return 'RESPONDED';
    const anyProgress = items.some(
      (item) => item.currentStatus === 'ANSWERED' || item.currentStatus === 'PARTIALLY_ANSWERED',
    );
    return anyProgress ? 'PARTIALLY_RESPONDED' : null;
  }
  const resolvedStatuses = new Set([
    'ACCEPTED',
    'REJECTED',
    'ACTION_REPORTED',
    'EXECUTION_REPORTED',
  ]);
  const allResolved = items.every((item) => resolvedStatuses.has(item.currentStatus));
  if (allResolved) return 'RESPONDED';
  const anyProgress = items.some((item) => resolvedStatuses.has(item.currentStatus));
  return anyProgress ? 'PARTIALLY_RESPONDED' : null;
}
