import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ProcessingStatus } from '@fiscaliza/database';
import { calculateFileSha256 } from './checksum';
import { TextChunker } from './chunker';
import { DocumentProcessingError } from './errors';
import type { DocumentIngestionRepository, DocumentObjectStorage } from './ingestion';
import { DocumentIngestionService } from './ingestion';
import { parseClamAvResponse } from './security-scanner';
import { TextQualityAnalyzer } from './text-quality';
import { validatePdfFile } from './validation';

void describe('pipeline documental compartilhado', () => {
  void it('calcula SHA-256 por stream', async () => {
    await withTemporaryFile(
      'documento.pdf',
      Buffer.from('%PDF-1.4\nconteudo'),
      async (filePath) => {
        const first = await calculateFileSha256(filePath);
        const second = await calculateFileSha256(filePath);
        assert.equal(first, second);
        assert.equal(first.length, 64);
      },
    );
  });

  void it('rejeita TXT renomeado para PDF por magic bytes', async () => {
    await withTemporaryFile('fraude.pdf', Buffer.from('isto não é pdf'), async (filePath) => {
      await assert.rejects(
        validatePdfFile(filePath, 'fraude.pdf', 1_000),
        (error: unknown) =>
          error instanceof DocumentProcessingError && error.code === 'INVALID_DOCUMENT_TYPE',
      );
    });
  });

  void it('rejeita arquivo acima do limite antes da ingestão', async () => {
    await withTemporaryFile(
      'grande.pdf',
      Buffer.from('%PDF-' + 'x'.repeat(100)),
      async (filePath) => {
        await assert.rejects(
          validatePdfFile(filePath, 'grande.pdf', 20),
          (error: unknown) =>
            error instanceof DocumentProcessingError && error.code === 'DOCUMENT_TOO_LARGE',
        );
      },
    );
  });

  void it('não grava segunda cópia física para checksum duplicado', async () => {
    await withTemporaryFile('duplicado.pdf', Buffer.from('%PDF-1.4\nmesmo'), async (filePath) => {
      let putCalls = 0;
      let duplicateAudits = 0;
      const repository: DocumentIngestionRepository = {
        findByChecksum: async () => ({
          id: 'existing',
          processingStatus: ProcessingStatus.COMPLETED,
        }),
        create: async () => undefined,
        recordDuplicate: async () => {
          duplicateAudits += 1;
        },
      };
      const storage: DocumentObjectStorage = {
        putFile: async () => {
          putCalls += 1;
        },
        deleteObject: async () => undefined,
      };
      const service = new DocumentIngestionService(repository, storage, { maxSizeBytes: 1_000 });
      const result = await service.ingest({
        filePath,
        originalName: 'duplicado.pdf',
        declaredMimeType: 'application/pdf',
        source: 'UPLOAD',
      });
      assert.equal(result.duplicate, true);
      assert.equal(result.documentId, 'existing');
      assert.equal(putCalls, 0);
      assert.equal(duplicateAudits, 1);
    });
  });

  void it('identifica cabeçalho curto e página vazia como candidatos a OCR', () => {
    const analyzer = new TextQualityAnalyzer();
    assert.equal(analyzer.analyze('').requiresOcr, true);
    assert.equal(analyzer.analyze('CÂMARA MUNICIPAL').requiresOcr, true);
    assert.equal(
      analyzer.analyze(
        'Este documento textual contém quantidade suficiente de palavras reconhecíveis e conteúdo contínuo para dispensar a etapa de reconhecimento óptico.',
      ).requiresOcr,
      false,
    );
  });

  void it('gera chunks estáveis sem atravessar a página', () => {
    const chunks = new TextChunker({ size: 100, overlap: 10 }).chunkPage(
      `${'Primeiro parágrafo com conteúdo. '.repeat(4)}\n\n${'Segundo parágrafo. '.repeat(5)}`,
    );
    assert.ok(chunks.length >= 2);
    assert.deepEqual(
      chunks.map(({ sequence }) => sequence),
      chunks.map((_, index) => index),
    );
    assert.ok(chunks.every(({ contentHash }) => contentHash.length === 64));
  });

  void it('interpreta respostas CLEAN e INFECTED do ClamAV sem expor arquivo', () => {
    assert.equal(parseClamAvResponse('stream: OK').status, 'CLEAN');
    const infected = parseClamAvResponse('stream: Eicar-Test-Signature FOUND');
    assert.equal(infected.status, 'INFECTED');
    assert.equal(infected.signature, 'Eicar-Test-Signature');
  });
});

async function withTemporaryFile(
  name: string,
  content: Uint8Array,
  operation: (filePath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-test-'));
  const filePath = path.join(directory, name);
  try {
    await writeFile(filePath, content);
    await operation(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
