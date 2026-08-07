import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentProcessingError } from '@fiscaliza/document-processing';
import type { WorkerConfig } from './config';

export interface RawExtractedPage {
  pageNumber: number;
  text: string;
}

export interface RawPdfExtraction {
  pageCount: number;
  pages: RawExtractedPage[];
}

export class PdfJsSubprocessExtractor {
  private readonly scriptPath: string;

  constructor(private readonly config: WorkerConfig) {
    this.scriptPath =
      config.PDF_EXTRACTOR_SCRIPT ?? path.resolve(__dirname, '..', 'scripts', 'extract-pdf.mjs');
  }

  async extract(pdfPath: string): Promise<RawPdfExtraction> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-pdf-'));
    const outputPath = path.join(temporaryDirectory, 'extraction.json');
    try {
      await runSubprocess(
        process.execPath,
        [
          '--max-old-space-size=512',
          this.scriptPath,
          pdfPath,
          outputPath,
          String(this.config.DOCUMENT_MAX_PAGES),
        ],
        this.config.DOCUMENT_PROCESSING_TIMEOUT,
      );
      const parsed = JSON.parse(await readFile(outputPath, 'utf8')) as unknown;
      if (!isExtraction(parsed)) {
        throw new DocumentProcessingError(
          'TEXT_EXTRACTION_FAILED',
          'O extrator retornou uma estrutura inválida.',
          true,
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      const message = error instanceof Error ? error.message : 'Falha ao abrir PDF.';
      if (message.includes('DOCUMENT_PAGE_LIMIT_EXCEEDED')) {
        throw new DocumentProcessingError(
          'DOCUMENT_PAGE_LIMIT_EXCEEDED',
          'O PDF excede o limite de páginas configurado.',
        );
      }
      throw new DocumentProcessingError('DOCUMENT_CORRUPTED', message, false);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function runSubprocess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: restrictedProcessEnvironment(),
    });
    const errors: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DocumentProcessingError('PROCESSING_TIMEOUT', 'Timeout ao extrair PDF.', true));
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.concat(errors).length < 8_192) errors.push(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const diagnostic = Buffer.concat(errors).toString('utf8');
      if (diagnostic.includes('DOCUMENT_PAGE_LIMIT_EXCEEDED')) {
        reject(
          new DocumentProcessingError(
            'DOCUMENT_PAGE_LIMIT_EXCEEDED',
            'O PDF excede o limite de páginas configurado.',
          ),
        );
        return;
      }
      if (
        diagnostic.includes('InvalidPDFException') ||
        diagnostic.includes('Invalid PDF structure')
      ) {
        reject(
          new DocumentProcessingError(
            'DOCUMENT_CORRUPTED',
            'O arquivo PDF está corrompido ou possui estrutura inválida.',
          ),
        );
        return;
      }
      reject(
        new DocumentProcessingError(
          'TEXT_EXTRACTION_FAILED',
          `Não foi possível extrair o texto do PDF (código ${code ?? 'desconhecido'}).`,
          true,
        ),
      );
    });
  });
}

function restrictedProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL'];
  return Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );
}

function isExtraction(value: unknown): value is RawPdfExtraction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RawPdfExtraction;
  return (
    Number.isInteger(candidate.pageCount) &&
    candidate.pageCount >= 1 &&
    Array.isArray(candidate.pages) &&
    candidate.pages.length === candidate.pageCount &&
    candidate.pages.every(
      (page, index) => page.pageNumber === index + 1 && typeof page.text === 'string',
    )
  );
}
