import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAttemptStatus,
  DocumentProcessingTrigger,
  DocumentSecurityStatus,
  OutboxStatus,
  Prisma,
  ProcessingStatus,
  TextExtractionStatus,
  OcrStatus,
} from '@fiscaliza/database';
import {
  DocumentIngestionService,
  PrismaDocumentIngestionRepository,
} from '@fiscaliza/document-processing';
import type { IngestionResult } from '@fiscaliza/document-processing';
import { PrismaService } from '../database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage.service';
import type { ListDocumentsDto } from './dto/list-documents.dto';

@Injectable()
export class DocumentsService {
  private readonly ingestion: DocumentIngestionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly config: ConfigService,
  ) {
    this.ingestion = new DocumentIngestionService(
      new PrismaDocumentIngestionRepository(prisma),
      storage,
      { maxSizeBytes: config.getOrThrow<number>('DOCUMENT_MAX_SIZE_MB') * 1024 * 1024 },
    );
  }

  ingestUpload(
    file: Express.Multer.File,
    actorId: string,
    requestId?: string,
  ): Promise<IngestionResult> {
    return this.ingestion.ingest({
      filePath: file.path,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      source: 'UPLOAD',
      actorId,
      ...(requestId ? { requestId } : {}),
    });
  }

  async list(query: ListDocumentsDto) {
    const where: Prisma.DocumentWhereInput = {
      ...(query.status ? { processingStatus: query.status } : {}),
      ...(query.securityStatus ? { securityStatus: query.securityStatus } : {}),
      ...(query.ocrStatus ? { ocrStatus: query.ocrStatus } : {}),
      ...(query.reviewRequired !== undefined ? { reviewRequired: query.reviewRequired } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          originalName: true,
          sizeBytes: true,
          pageCount: true,
          processingStatus: true,
          textExtractionStatus: true,
          ocrStatus: true,
          securityStatus: true,
          reviewRequired: true,
          processingError: true,
          lastErrorCode: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.document.count({ where }),
    ]);
    return {
      items: items.map((item) => ({ ...item, sizeBytes: item.sizeBytes.toString() })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sha256: true,
        sizeBytes: true,
        pageCount: true,
        kind: true,
        accessLevel: true,
        ingestionSource: true,
        processingStatus: true,
        securityStatus: true,
        textExtractionStatus: true,
        ocrStatus: true,
        extractionConfidence: true,
        processingError: true,
        lastErrorCode: true,
        lastErrorAt: true,
        processingAttempt: true,
        reviewRequired: true,
        quarantinedAt: true,
        securityScannedAt: true,
        processingStartedAt: true,
        processingCompletedAt: true,
        createdAt: true,
        updatedAt: true,
        processingAttempts: { orderBy: { attempt: 'desc' } },
        _count: { select: { pages: true, chunks: true } },
      },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    return { ...document, sizeBytes: document.sizeBytes.toString(), embeddingCreated: false };
  }

  async pages(id: string) {
    await this.assertExists(id);
    return this.prisma.documentPage.findMany({
      where: { documentId: id },
      orderBy: { pageNumber: 'asc' },
      select: {
        id: true,
        pageNumber: true,
        extractedText: true,
        ocrText: true,
        effectiveText: true,
        effectiveTextSource: true,
        extractionConfidence: true,
        qualityScore: true,
        characterCount: true,
        requiresOcr: true,
        qualityReason: true,
        ocrStatus: true,
        ocrConfidence: true,
      },
    });
  }

  async page(id: string, pageNumber: number) {
    if (pageNumber < 1) throw new NotFoundException('Página não encontrada.');
    const page = await this.prisma.documentPage.findUnique({
      where: { documentId_pageNumber: { documentId: id, pageNumber } },
    });
    if (!page) throw new NotFoundException('Página não encontrada.');
    return page;
  }

  async reprocess(id: string, actorId: string, requestId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.document.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Documento não encontrado.');
      if (
        current.processingStatus !== ProcessingStatus.FAILED &&
        current.processingStatus !== ProcessingStatus.NEEDS_REVIEW
      ) {
        throw new ConflictException(
          'Somente documentos com falha ou pendentes de revisão podem ser reprocessados.',
        );
      }
      const nextAttempt = current.processingAttempt + 1;
      const claimed = await transaction.document.updateMany({
        where: {
          id,
          processingAttempt: current.processingAttempt,
          processingStatus: current.processingStatus,
        },
        data: {
          processingAttempt: nextAttempt,
          processingStatus: ProcessingStatus.QUARANTINED,
          securityStatus: DocumentSecurityStatus.PENDING,
          textExtractionStatus: TextExtractionStatus.PENDING,
          ocrStatus: OcrStatus.NOT_REQUIRED,
          reviewRequired: false,
          processingError: null,
          lastErrorCode: null,
          lastErrorAt: null,
          processingStartedAt: null,
          processingCompletedAt: null,
          pageCount: null,
          extractedText: null,
          ocrText: null,
          extractionConfidence: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Outro reprocessamento já foi solicitado para este documento.');
      }
      await transaction.documentChunk.deleteMany({ where: { documentId: id } });
      await transaction.documentPage.deleteMany({ where: { documentId: id } });
      await transaction.documentProcessingAttempt.create({
        data: {
          documentId: id,
          attempt: nextAttempt,
          trigger: DocumentProcessingTrigger.REPROCESS,
          status: DocumentAttemptStatus.QUEUED,
          requestedById: actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'DOCUMENT_REPROCESS_REQUESTED',
          resourceType: 'Document',
          resourceId: id,
          requestId,
          metadata: { attempt: nextAttempt, previousStatus: current.processingStatus },
        },
      });
      const event = await transaction.outboxEvent.create({
        data: {
          eventType: 'DocumentReprocessRequested',
          aggregateType: 'Document',
          aggregateId: id,
          status: OutboxStatus.PENDING,
          payload: {
            documentId: id,
            attempt: nextAttempt,
            correlationId: requestId ?? crypto.randomUUID(),
          },
        },
      });
      return { documentId: id, attempt: nextAttempt, outboxEventId: event.id, accepted: true };
    });
  }

  async download(id: string, actorId: string, requestId?: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (document.securityStatus !== DocumentSecurityStatus.CLEAN) {
      throw new ForbiddenException(
        'O original não está disponível porque não foi aprovado pelo scanner de segurança.',
      );
    }
    const ttlSeconds = this.config.getOrThrow<number>('SIGNED_URL_TTL_SECONDS');
    const url = await this.storage.createSignedDownloadUrl(
      document.storageKey,
      document.originalName,
      ttlSeconds,
    );
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'DOCUMENT_DOWNLOAD',
        resourceType: 'Document',
        resourceId: id,
        requestId,
        metadata: { ttlSeconds },
      },
    });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() };
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.document.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Documento não encontrado.');
  }
}
