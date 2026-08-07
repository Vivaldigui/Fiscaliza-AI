import type { PrismaClient } from '@fiscaliza/database';
import { DocumentAttemptStatus, ProcessingStatus } from '@fiscaliza/database';
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
});
