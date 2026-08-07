import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@fiscaliza/database';
import {
  DocumentSecurityStatus,
  DocumentTextSource,
  OcrStatus,
  ProcessingStatus,
  TextExtractionStatus,
} from '@fiscaliza/database';
import {
  type DocumentSecurityScanner,
  type OcrProvider,
  TextChunker,
  TextQualityAnalyzer,
} from '@fiscaliza/document-processing';
import type { WorkerConfig } from './config';
import type { PersistedPage } from './document-state';
import type { DocumentProcessingStateService } from './document-state';
import type { StructuredLogger } from './logger';
import type { PdfJsSubprocessExtractor } from './pdf-extractor';
import { Semaphore } from './semaphore';
import type { WorkerObjectStorage } from './storage';

export class DocumentPipeline {
  private readonly quality: TextQualityAnalyzer;
  private readonly chunker: TextChunker;
  private readonly ocrSemaphore: Semaphore;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly state: DocumentProcessingStateService,
    private readonly storage: WorkerObjectStorage,
    private readonly extractor: PdfJsSubprocessExtractor,
    private readonly scanner: DocumentSecurityScanner,
    private readonly ocr: OcrProvider,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {
    this.quality = new TextQualityAnalyzer({
      minimumCharacters: config.DOCUMENT_TEXT_MIN_CHARACTERS,
      minimumWords: config.DOCUMENT_TEXT_MIN_WORDS,
      minimumQualityScore: config.DOCUMENT_TEXT_MIN_QUALITY,
    });
    this.chunker = new TextChunker({
      size: config.DOCUMENT_CHUNK_SIZE,
      overlap: config.DOCUMENT_CHUNK_OVERLAP,
    });
    this.ocrSemaphore = new Semaphore(config.DOCUMENT_OCR_CONCURRENCY);
  }

  async process(documentId: string, attempt: number, jobId: string): Promise<void> {
    const startedAt = performance.now();
    if (!(await this.state.start(documentId, attempt))) {
      this.logger.info('Job documental já concluído ou obsoleto.', { documentId, attempt, jobId });
      return;
    }
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.processingAttempt !== attempt) return;

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-document-'));
    const pdfPath = path.join(temporaryDirectory, 'original.pdf');
    try {
      const downloadStartedAt = performance.now();
      await this.storage.downloadToFile(document.storageKey, pdfPath);
      this.logger.debug('Original baixado para processamento isolado.', {
        documentId,
        attempt,
        jobId,
        stage: 'download',
        durationMs: elapsed(downloadStartedAt),
      });

      const scanStartedAt = performance.now();
      const scan = await this.scanner.scan(pdfPath);
      const securityStatus = DocumentSecurityStatus[scan.status];
      await this.state.securityResult(
        documentId,
        attempt,
        securityStatus,
        scan.scanner,
        scan.detail,
      );
      this.logger.info('Verificação de segurança concluída.', {
        documentId,
        attempt,
        jobId,
        stage: 'security-scan',
        securityStatus,
        durationMs: elapsed(scanStartedAt),
      });
      if (scan.status === 'INFECTED') {
        await this.state.infected(documentId, attempt, scan.signature);
        return;
      }

      let storageKey = document.storageKey;
      if (scan.status === 'CLEAN') {
        storageKey = await this.storage.promoteObject(
          document.storageKey,
          documentId,
          new Date().getUTCFullYear(),
        );
        await this.prisma.document.updateMany({
          where: { id: documentId, processingAttempt: attempt },
          data: { storageKey },
        });
      } else {
        this.logger.warn('Antivírus desabilitado; original permanece em quarentena.', {
          documentId,
          attempt,
          jobId,
          stage: 'security-scan',
        });
      }

      await this.state.transition(
        documentId,
        attempt,
        ProcessingStatus.SECURITY_SCAN,
        ProcessingStatus.EXTRACTING,
        { textExtractionStatus: TextExtractionStatus.PROCESSING },
      );
      const extractionStartedAt = performance.now();
      const extraction = await this.extractor.extract(pdfPath);
      this.logger.info('Extração PDF concluída.', {
        documentId,
        attempt,
        jobId,
        stage: 'extraction',
        pageCount: extraction.pageCount,
        durationMs: elapsed(extractionStartedAt),
      });

      const qualities = extraction.pages.map((page) => ({
        page,
        quality: this.quality.analyze(page.text),
      }));
      const requiresOcr = qualities.some(({ quality }) => quality.requiresOcr);
      if (requiresOcr) {
        await this.state.transition(
          documentId,
          attempt,
          ProcessingStatus.EXTRACTING,
          ProcessingStatus.OCR,
          {
            ocrStatus: this.config.DOCUMENT_OCR_ENABLED ? OcrStatus.PROCESSING : OcrStatus.SKIPPED,
          },
        );
      }

      const pages: PersistedPage[] = [];
      const ocrErrors: string[] = [];
      const ocrStartedAt = performance.now();
      for (const { page, quality: extractionQuality } of qualities) {
        let ocrText: string | null = null;
        let ocrStatus: OcrStatus = OcrStatus.NOT_REQUIRED;
        let effectiveText = page.text;
        let effectiveTextSource: DocumentTextSource = page.text
          ? DocumentTextSource.EXTRACTED
          : DocumentTextSource.EMPTY;
        let effectiveQuality = extractionQuality;
        let ocrConfidence: number | null = null;

        if (extractionQuality.requiresOcr && this.config.DOCUMENT_OCR_ENABLED) {
          try {
            const result = await this.ocrSemaphore.use(() =>
              retryOcr(() =>
                this.ocr.recognizePage({
                  pdfPath,
                  pageNumber: page.pageNumber,
                  languages: this.config.DOCUMENT_OCR_LANGUAGES,
                  timeoutMs: this.config.DOCUMENT_OCR_TIMEOUT_MS,
                }),
              ),
            );
            ocrText = result.text;
            const ocrQuality = this.quality.analyze(ocrText);
            ocrConfidence = result.confidence ?? ocrQuality.qualityScore;
            ocrStatus = ocrQuality.requiresOcr ? OcrStatus.PARTIAL : OcrStatus.COMPLETED;
            if (ocrText && ocrQuality.qualityScore > extractionQuality.qualityScore) {
              effectiveText = ocrText;
              effectiveTextSource = DocumentTextSource.OCR;
              effectiveQuality = ocrQuality;
            }
          } catch (error) {
            ocrStatus = OcrStatus.FAILED;
            ocrErrors.push(`página ${page.pageNumber}: OCR falhou`);
            this.logger.warn('OCR de página falhou após retries controlados.', {
              documentId,
              attempt,
              jobId,
              stage: 'ocr',
              pageNumber: page.pageNumber,
              error: error instanceof Error ? error.message : 'falha desconhecida',
            });
          }
        } else if (extractionQuality.requiresOcr) {
          ocrStatus = OcrStatus.SKIPPED;
        }

        pages.push({
          pageNumber: page.pageNumber,
          extractedText: page.text,
          ocrText,
          effectiveText,
          effectiveTextSource,
          extractionQuality,
          effectiveQuality,
          ocrStatus,
          ocrConfidence,
          chunks: [],
        });
      }
      if (requiresOcr) {
        this.logger.info('Etapa OCR concluída.', {
          documentId,
          attempt,
          jobId,
          stage: 'ocr',
          requestedPages: qualities.filter(({ quality }) => quality.requiresOcr).length,
          durationMs: elapsed(ocrStartedAt),
        });
      }

      await this.state.transition(
        documentId,
        attempt,
        requiresOcr ? ProcessingStatus.OCR : ProcessingStatus.EXTRACTING,
        ProcessingStatus.CHUNKING,
      );
      const chunkStartedAt = performance.now();
      for (const page of pages) page.chunks = this.chunker.chunkPage(page.effectiveText);
      const overallOcrStatus = determineOcrStatus(pages, requiresOcr);
      const unreadable = pages.filter((page) => page.effectiveQuality.requiresOcr).length;
      const messages = [
        ...(scan.status === 'SKIPPED' ? ['antivírus não executado'] : []),
        ...(unreadable ? [`${unreadable} página(s) com texto insuficiente`] : []),
        ...ocrErrors,
      ];
      const finalStatus = await this.state.persistCompletion({
        documentId,
        attempt,
        pages,
        securityRequiresReview: scan.status === 'SKIPPED',
        ocrStatus: overallOcrStatus,
        ...(messages.length ? { processingError: messages.join('; ') } : {}),
      });
      this.logger.info('Processamento documental finalizado.', {
        documentId,
        attempt,
        jobId,
        stage: 'completed',
        finalStatus,
        pageCount: pages.length,
        chunkCount: pages.reduce((sum, page) => sum + page.chunks.length, 0),
        chunkingDurationMs: elapsed(chunkStartedAt),
        durationMs: elapsed(startedAt),
        storageKey,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function determineOcrStatus(pages: PersistedPage[], required: boolean): OcrStatus {
  if (!required) return OcrStatus.NOT_REQUIRED;
  const statuses = pages
    .filter((page) => page.extractionQuality.requiresOcr)
    .map((page) => page.ocrStatus);
  if (statuses.every((status) => status === OcrStatus.SKIPPED)) return OcrStatus.SKIPPED;
  if (statuses.every((status) => status === OcrStatus.COMPLETED)) return OcrStatus.COMPLETED;
  if (statuses.every((status) => status === OcrStatus.FAILED)) return OcrStatus.FAILED;
  return OcrStatus.PARTIAL;
}

async function retryOcr<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
