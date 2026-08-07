import type { DocumentTextSource, Prisma, PrismaClient } from '@fiscaliza/database';
import {
  DocumentAttemptStatus,
  DocumentSecurityStatus,
  OcrStatus,
  ProcessingStatus,
  TextExtractionStatus,
} from '@fiscaliza/database';
import type { TextChunk, TextQualityResult } from '@fiscaliza/document-processing';

const allowedTransitions: Record<ProcessingStatus, ProcessingStatus[]> = {
  RECEIVED: [ProcessingStatus.QUARANTINED, ProcessingStatus.FAILED],
  QUARANTINED: [ProcessingStatus.SECURITY_SCAN, ProcessingStatus.FAILED],
  SECURITY_SCAN: [
    ProcessingStatus.EXTRACTING,
    ProcessingStatus.NEEDS_REVIEW,
    ProcessingStatus.FAILED,
  ],
  UPLOADED: [ProcessingStatus.QUARANTINED, ProcessingStatus.FAILED],
  EXTRACTING: [ProcessingStatus.OCR, ProcessingStatus.CHUNKING, ProcessingStatus.FAILED],
  OCR: [ProcessingStatus.CHUNKING, ProcessingStatus.FAILED],
  CHUNKING: [ProcessingStatus.COMPLETED, ProcessingStatus.NEEDS_REVIEW, ProcessingStatus.FAILED],
  CLASSIFYING: [ProcessingStatus.FAILED],
  ASSOCIATING: [ProcessingStatus.FAILED],
  ANALYZING: [ProcessingStatus.FAILED],
  COMPLETED: [],
  NEEDS_REVIEW: [ProcessingStatus.QUARANTINED],
  FAILED: [ProcessingStatus.QUARANTINED],
};

export interface PersistedPage {
  pageNumber: number;
  extractedText: string;
  ocrText: string | null;
  effectiveText: string;
  effectiveTextSource: DocumentTextSource;
  extractionQuality: TextQualityResult;
  effectiveQuality: TextQualityResult;
  ocrStatus: OcrStatus;
  ocrConfidence: number | null;
  chunks: TextChunk[];
}

export interface CompletionInput {
  documentId: string;
  attempt: number;
  pages: PersistedPage[];
  securityRequiresReview: boolean;
  ocrStatus: OcrStatus;
  processingError?: string;
}

export class DocumentProcessingStateService {
  constructor(private readonly prisma: PrismaClient) {}

  async start(documentId: string, attempt: number): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const processingAttempt = await transaction.documentProcessingAttempt.findUnique({
        where: { documentId_attempt: { documentId, attempt } },
      });
      if (!processingAttempt) throw new Error('Tentativa documental não encontrada.');
      if (
        processingAttempt.status === DocumentAttemptStatus.COMPLETED ||
        processingAttempt.status === DocumentAttemptStatus.NEEDS_REVIEW ||
        processingAttempt.status === DocumentAttemptStatus.FAILED
      ) {
        return false;
      }
      const claimed = await transaction.document.updateMany({
        where: {
          id: documentId,
          processingAttempt: attempt,
          processingStatus: ProcessingStatus.QUARANTINED,
        },
        data: {
          processingStatus: ProcessingStatus.SECURITY_SCAN,
          securityStatus: DocumentSecurityStatus.SCANNING,
          processingStartedAt: new Date(),
          processingCompletedAt: null,
        },
      });
      if (claimed.count !== 1) {
        const current = await transaction.document.findUnique({ where: { id: documentId } });
        if (!current || current.processingAttempt !== attempt) return false;
        if (current.processingStatus === ProcessingStatus.SECURITY_SCAN) return true;
        throw new Error(`Transição inválida ${current.processingStatus} → SECURITY_SCAN.`);
      }
      await transaction.documentProcessingAttempt.update({
        where: { documentId_attempt: { documentId, attempt } },
        data: { status: DocumentAttemptStatus.PROCESSING, startedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DOCUMENT_PROCESSING_STARTED',
          resourceType: 'Document',
          resourceId: documentId,
          metadata: { attempt },
        },
      });
      return true;
    });
  }

  async transition(
    documentId: string,
    attempt: number,
    from: ProcessingStatus,
    to: ProcessingStatus,
    data: Prisma.DocumentUpdateManyMutationInput = {},
  ): Promise<void> {
    if (!allowedTransitions[from].includes(to))
      throw new Error(`Transição inválida ${from} → ${to}.`);
    const result = await this.prisma.document.updateMany({
      where: { id: documentId, processingAttempt: attempt, processingStatus: from },
      data: { ...data, processingStatus: to },
    });
    if (result.count === 1) return;
    const current = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (current?.processingAttempt === attempt && current.processingStatus === to) return;
    throw new Error(`Estado concorrente impediu ${from} → ${to}.`);
  }

  async prepareAutomaticRetry(documentId: string, attempt: number): Promise<void> {
    await this.prisma.document.updateMany({
      where: {
        id: documentId,
        processingAttempt: attempt,
        processingStatus: {
          in: [
            ProcessingStatus.SECURITY_SCAN,
            ProcessingStatus.EXTRACTING,
            ProcessingStatus.OCR,
            ProcessingStatus.CHUNKING,
          ],
        },
      },
      data: {
        processingStatus: ProcessingStatus.QUARANTINED,
        securityStatus: DocumentSecurityStatus.PENDING,
        textExtractionStatus: TextExtractionStatus.PENDING,
        ocrStatus: OcrStatus.NOT_REQUIRED,
      },
    });
  }

  async recordRetryError(documentId: string, attempt: number, code: string, message: string) {
    await this.prisma.$transaction([
      this.prisma.document.updateMany({
        where: { id: documentId, processingAttempt: attempt },
        data: { processingError: message, lastErrorCode: code, lastErrorAt: new Date() },
      }),
      this.prisma.documentProcessingAttempt.updateMany({
        where: { documentId, attempt },
        data: { errorCode: code, errorMessage: message },
      }),
    ]);
  }

  async securityResult(
    documentId: string,
    attempt: number,
    status: DocumentSecurityStatus,
    scanner: string,
    detail: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.document.updateMany({
        where: { id: documentId, processingAttempt: attempt },
        data: { securityStatus: status, securityScannedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          action: 'DOCUMENT_SECURITY_SCAN',
          resourceType: 'Document',
          resourceId: documentId,
          metadata: { attempt, status, scanner, detail },
        },
      }),
    ]);
  }

  async infected(documentId: string, attempt: number, signature?: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.document.updateMany({
        where: { id: documentId, processingAttempt: attempt },
        data: {
          processingStatus: ProcessingStatus.NEEDS_REVIEW,
          securityStatus: DocumentSecurityStatus.INFECTED,
          reviewRequired: true,
          processingError: 'Ameaça detectada; original mantido em quarentena.',
          lastErrorCode: 'DOCUMENT_INFECTED',
          lastErrorAt: new Date(),
          processingCompletedAt: new Date(),
        },
      });
      await transaction.documentProcessingAttempt.updateMany({
        where: { documentId, attempt },
        data: {
          status: DocumentAttemptStatus.NEEDS_REVIEW,
          errorCode: 'DOCUMENT_INFECTED',
          errorMessage: 'Ameaça detectada pelo scanner.',
          finishedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DOCUMENT_PROCESSING_FAILED',
          resourceType: 'Document',
          resourceId: documentId,
          metadata: { attempt, code: 'DOCUMENT_INFECTED', ...(signature ? { signature } : {}) },
        },
      });
    });
  }

  async persistCompletion(input: CompletionInput): Promise<ProcessingStatus> {
    const reviewRequired =
      input.securityRequiresReview || input.pages.some((page) => page.effectiveQuality.requiresOcr);
    const finalStatus = reviewRequired ? ProcessingStatus.NEEDS_REVIEW : ProcessingStatus.COMPLETED;
    const effectiveAverage = average(input.pages.map((page) => page.effectiveQuality.qualityScore));
    const extractionNeedsOcr = input.pages.some((page) => page.extractionQuality.requiresOcr);
    const extractedText = input.pages.map((page) => page.extractedText).join('\n\f\n');
    const ocrText = input.pages
      .map((page) => page.ocrText)
      .filter((value): value is string => Boolean(value))
      .join('\n\f\n');

    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.document.findUnique({ where: { id: input.documentId } });
      if (
        !current ||
        current.processingAttempt !== input.attempt ||
        current.processingStatus !== ProcessingStatus.CHUNKING
      ) {
        if (
          current?.processingAttempt === input.attempt &&
          current.processingStatus === finalStatus
        )
          return;
        throw new Error('Documento não está pronto para persistir o resultado.');
      }
      await transaction.documentChunk.deleteMany({ where: { documentId: input.documentId } });
      await transaction.documentPage.deleteMany({ where: { documentId: input.documentId } });
      for (const page of input.pages) {
        const created = await transaction.documentPage.create({
          data: {
            documentId: input.documentId,
            pageNumber: page.pageNumber,
            extractedText: page.extractedText || null,
            ocrText: page.ocrText,
            effectiveText: page.effectiveText,
            effectiveTextSource: page.effectiveTextSource,
            extractionConfidence: page.extractionQuality.qualityScore,
            qualityScore: page.effectiveQuality.qualityScore,
            characterCount: page.effectiveQuality.characterCount,
            requiresOcr: page.extractionQuality.requiresOcr,
            qualityReason: page.effectiveQuality.reason,
            ocrStatus: page.ocrStatus,
            ocrConfidence: page.ocrConfidence,
          },
        });
        if (page.chunks.length) {
          await transaction.documentChunk.createMany({
            data: page.chunks.map((chunk) => ({
              documentId: input.documentId,
              pageId: created.id,
              pageNumber: page.pageNumber,
              sequence: chunk.sequence,
              content: chunk.content,
              contentHash: chunk.contentHash,
            })),
          });
        }
      }
      await transaction.document.update({
        where: { id: input.documentId },
        data: {
          processingStatus: finalStatus,
          textExtractionStatus: extractionNeedsOcr
            ? TextExtractionStatus.PARTIAL
            : TextExtractionStatus.COMPLETED,
          ocrStatus: input.ocrStatus,
          pageCount: input.pages.length,
          extractedText,
          ocrText: ocrText || null,
          extractionConfidence: effectiveAverage,
          reviewRequired,
          processingError: input.processingError ?? null,
          processingCompletedAt: new Date(),
        },
      });
      await transaction.documentProcessingAttempt.update({
        where: {
          documentId_attempt: { documentId: input.documentId, attempt: input.attempt },
        },
        data: {
          status: reviewRequired
            ? DocumentAttemptStatus.NEEDS_REVIEW
            : DocumentAttemptStatus.COMPLETED,
          finishedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DOCUMENT_PROCESSING_COMPLETED',
          resourceType: 'Document',
          resourceId: input.documentId,
          metadata: {
            attempt: input.attempt,
            finalStatus,
            pageCount: input.pages.length,
            ocrStatus: input.ocrStatus,
          },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'DocumentProcessed',
          aggregateType: 'Document',
          aggregateId: input.documentId,
          payload: {
            documentId: input.documentId,
            attempt: input.attempt,
            status: finalStatus,
          },
        },
      });
    });
    return finalStatus;
  }

  async markFailure(
    documentId: string,
    attempt: number,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const attemptRecord = await transaction.documentProcessingAttempt.findUnique({
        where: { documentId_attempt: { documentId, attempt } },
      });
      if (
        !attemptRecord ||
        attemptRecord.status === DocumentAttemptStatus.COMPLETED ||
        attemptRecord.status === DocumentAttemptStatus.FAILED ||
        attemptRecord.status === DocumentAttemptStatus.NEEDS_REVIEW
      ) {
        return;
      }
      await transaction.document.updateMany({
        where: { id: documentId, processingAttempt: attempt },
        data: {
          processingStatus: ProcessingStatus.FAILED,
          reviewRequired: true,
          processingError: message,
          lastErrorCode: code,
          lastErrorAt: new Date(),
          processingCompletedAt: new Date(),
          ...(code === 'SECURITY_SCAN_FAILED'
            ? { securityStatus: DocumentSecurityStatus.FAILED }
            : {}),
        },
      });
      await transaction.documentProcessingAttempt.update({
        where: { documentId_attempt: { documentId, attempt } },
        data: {
          status: DocumentAttemptStatus.FAILED,
          errorCode: code,
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DOCUMENT_PROCESSING_FAILED',
          resourceType: 'Document',
          resourceId: documentId,
          metadata: { attempt, code },
        },
      });
    });
  }

  async finalizeRecordedFailure(
    documentId: string,
    attempt: number,
    fallbackCode: string,
    fallbackMessage: string,
  ): Promise<void> {
    const recorded = await this.prisma.documentProcessingAttempt.findUnique({
      where: { documentId_attempt: { documentId, attempt } },
      select: { errorCode: true, errorMessage: true },
    });
    await this.markFailure(
      documentId,
      attempt,
      recorded?.errorCode ?? fallbackCode,
      recorded?.errorMessage ?? fallbackMessage,
    );
  }
}

function average(values: number[]): number | null {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : null;
}
