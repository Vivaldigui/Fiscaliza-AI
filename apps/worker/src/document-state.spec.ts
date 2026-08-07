import type { PrismaClient } from '@fiscaliza/database';
import {
  DocumentAttemptStatus,
  DocumentTextSource,
  OcrStatus,
  ProcessingStatus,
} from '@fiscaliza/database';
import { DocumentProcessingStateService } from './document-state';

describe('DocumentProcessingStateService', () => {
  it('trata o mesmo job concluído duas vezes como no-op idempotente', async () => {
    const transaction = {
      documentProcessingAttempt: {
        findUnique: jest.fn().mockResolvedValue({ status: DocumentAttemptStatus.COMPLETED }),
      },
      document: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: (operation: (value: typeof transaction) => unknown) => operation(transaction),
    } as unknown as PrismaClient;
    const state = new DocumentProcessingStateService(prisma);
    await expect(state.start('document-1', 1)).resolves.toBe(false);
    expect(transaction.document.updateMany).not.toHaveBeenCalled();
  });

  it('rejeita transição absurda de COMPLETED para EXTRACTING', async () => {
    const state = new DocumentProcessingStateService({} as PrismaClient);
    await expect(
      state.transition('document-1', 1, ProcessingStatus.COMPLETED, ProcessingStatus.EXTRACTING),
    ).rejects.toThrow('Transição inválida');
  });

  it('não duplica auditoria quando a falha já foi finalizada', async () => {
    const transaction = {
      documentProcessingAttempt: {
        findUnique: jest.fn().mockResolvedValue({ status: DocumentAttemptStatus.FAILED }),
      },
      document: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: (operation: (value: typeof transaction) => unknown) => operation(transaction),
    } as unknown as PrismaClient;
    const state = new DocumentProcessingStateService(prisma);

    await state.markFailure('document-1', 1, 'DOCUMENT_CORRUPTED', 'PDF inválido.');

    expect(transaction.document.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('preserva derivados anteriores e substitui somente a tentativa atual', async () => {
    const pageCreate = jest.fn().mockResolvedValue({ id: 'page-current' });
    const pageDelete = jest.fn();
    const chunkDelete = jest.fn();
    const transaction = {
      document: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'document-1',
          processingAttempt: 2,
          processingStatus: ProcessingStatus.CHUNKING,
        }),
        update: jest.fn(),
      },
      documentProcessingAttempt: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'attempt-current' }),
        update: jest.fn(),
      },
      documentChunk: { deleteMany: chunkDelete, createMany: jest.fn() },
      documentPage: { deleteMany: pageDelete, create: pageCreate },
      auditLog: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: (operation: (value: typeof transaction) => unknown) => operation(transaction),
    } as unknown as PrismaClient;
    const state = new DocumentProcessingStateService(prisma);
    await state.persistCompletion({
      documentId: 'document-1',
      attempt: 2,
      securityRequiresReview: false,
      ocrStatus: OcrStatus.NOT_REQUIRED,
      pages: [
        {
          pageNumber: 1,
          extractedText: 'texto',
          ocrText: null,
          effectiveText: 'texto',
          effectiveTextSource: DocumentTextSource.EXTRACTED,
          extractionQuality: quality(),
          effectiveQuality: quality(),
          ocrStatus: OcrStatus.NOT_REQUIRED,
          ocrConfidence: null,
          chunks: [],
        },
      ],
    });

    expect(chunkDelete).toHaveBeenCalledWith({
      where: { processingAttemptId: 'attempt-current' },
    });
    expect(pageDelete).toHaveBeenCalledWith({
      where: { processingAttemptId: 'attempt-current' },
    });
    expect(pageCreate.mock.calls[0]?.[0].data.processingAttemptId).toBe('attempt-current');
  });
});

function quality() {
  return {
    characterCount: 5,
    printableRatio: 1,
    wordCount: 1,
    alphaNumericRatio: 1,
    fragmentationRatio: 0,
    qualityScore: 1,
    requiresOcr: false,
    reason: 'texto digital suficiente',
  };
}
