import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@fiscaliza/database';
import {
  DocumentIngestionSource,
  DocumentProcessingTrigger,
  Prisma,
  ProcessingStatus,
} from '@fiscaliza/database';
import { calculateFileSha256 } from './checksum';
import { DocumentProcessingError } from './errors';
import type { IngestionInput, IngestionResult } from './types';
import { validatePdfFile } from './validation';

export interface DocumentObjectStorage {
  putFile(storageKey: string, filePath: string, contentType: string): Promise<void>;
  deleteObject(storageKey: string): Promise<void>;
}

export interface DocumentIngestionConfig {
  maxSizeBytes: number;
}

export interface DocumentIngestionRepository {
  findByChecksum(
    sha256: string,
  ): Promise<{ id: string; processingStatus: ProcessingStatus } | null>;
  create(input: CreateDocumentInput): Promise<void>;
  recordDuplicate(documentId: string, sha256: string, input: IngestionInput): Promise<void>;
}

export class DocumentIngestionService {
  constructor(
    private readonly repository: DocumentIngestionRepository,
    private readonly storage: DocumentObjectStorage,
    private readonly config: DocumentIngestionConfig,
  ) {}

  async ingest(input: IngestionInput): Promise<IngestionResult> {
    if (input.declaredMimeType && input.declaredMimeType.toLowerCase() !== 'application/pdf') {
      throw new DocumentProcessingError(
        'INVALID_DOCUMENT_TYPE',
        'O tipo MIME declarado não é application/pdf.',
      );
    }
    const validated = await validatePdfFile(
      input.filePath,
      input.originalName,
      this.config.maxSizeBytes,
    );
    const sha256 = await calculateFileSha256(input.filePath);
    const duplicate = await this.repository.findByChecksum(sha256);
    if (duplicate) {
      await this.repository.recordDuplicate(duplicate.id, sha256, input);
      return {
        documentId: duplicate.id,
        duplicate: true,
        sha256,
        processingStatus: duplicate.processingStatus,
      };
    }

    const documentId = randomUUID();
    const storageKey = `quarantine/${documentId}/original.pdf`;
    await this.storage.putFile(storageKey, input.filePath, validated.mimeType);
    try {
      await this.repository.create({
        documentId,
        storageKey,
        sha256,
        sizeBytes: validated.sizeBytes,
        originalName: validated.sanitizedName,
        source: input.source,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
      return {
        documentId,
        duplicate: false,
        sha256,
        processingStatus: ProcessingStatus.QUARANTINED,
      };
    } catch (error) {
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedDuplicate = await this.repository.findByChecksum(sha256);
        if (racedDuplicate) {
          await this.repository.recordDuplicate(racedDuplicate.id, sha256, input);
          return {
            documentId: racedDuplicate.id,
            duplicate: true,
            sha256,
            processingStatus: racedDuplicate.processingStatus,
          };
        }
      }
      throw error;
    }
  }
}

export interface CreateDocumentInput {
  documentId: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  originalName: string;
  source: IngestionInput['source'];
  actorId?: string;
  requestId?: string;
}

export class PrismaDocumentIngestionRepository implements DocumentIngestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByChecksum(
    sha256: string,
  ): Promise<{ id: string; processingStatus: ProcessingStatus } | null> {
    return this.prisma.document.findUnique({
      where: { sha256 },
      select: { id: true, processingStatus: true },
    });
  }

  async create(input: CreateDocumentInput): Promise<void> {
    const source = DocumentIngestionSource[input.source];
    const trigger =
      input.source === 'INBOX' ? DocumentProcessingTrigger.INBOX : DocumentProcessingTrigger.UPLOAD;
    await this.prisma.$transaction(async (transaction) => {
      const documentData = {
        id: input.documentId,
        originalName: input.originalName,
        mimeType: 'application/pdf',
        storageKey: input.storageKey,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
        ingestionSource: source,
        ...(input.actorId ? { uploadedById: input.actorId } : {}),
        processingStatus: ProcessingStatus.QUARANTINED,
        quarantinedAt: new Date(),
        processingAttempt: 1,
      } satisfies Prisma.DocumentUncheckedCreateInput;
      await transaction.document.create({ data: documentData });
      await transaction.documentProcessingAttempt.create({
        data: {
          documentId: input.documentId,
          attempt: 1,
          trigger,
          ...(input.actorId ? { requestedById: input.actorId } : {}),
        },
      });
      await transaction.auditLog.create({
        data: {
          ...(input.actorId ? { actorId: input.actorId } : {}),
          action: 'DOCUMENT_UPLOAD',
          resourceType: 'Document',
          resourceId: input.documentId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          newState: {
            source,
            sha256: input.sha256,
            sizeBytes: String(input.sizeBytes),
            processingStatus: ProcessingStatus.QUARANTINED,
          },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: 'DocumentUploaded',
          aggregateType: 'Document',
          aggregateId: input.documentId,
          payload: {
            documentId: input.documentId,
            attempt: 1,
            correlationId: input.requestId ?? randomUUID(),
          },
        },
      });
    });
  }

  async recordDuplicate(documentId: string, sha256: string, input: IngestionInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        action: 'DOCUMENT_DUPLICATE',
        resourceType: 'Document',
        resourceId: documentId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        metadata: { sha256, source: input.source },
      },
    });
  }
}
