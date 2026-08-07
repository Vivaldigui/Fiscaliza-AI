import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DocumentProcessingError } from './errors';

const execFileAsync = promisify(execFile);

export interface OcrResult {
  text: string;
  provider: string;
  confidence?: number;
}

export interface OcrRequest {
  pdfPath: string;
  pageNumber: number;
  languages: string;
  timeoutMs: number;
}

export interface OcrProvider {
  recognizePage(request: OcrRequest): Promise<OcrResult>;
}

export class DisabledOcrProvider implements OcrProvider {
  async recognizePage(): Promise<OcrResult> {
    throw new DocumentProcessingError('OCR_FAILED', 'OCR está desabilitado.', false);
  }
}

export class TesseractCliOcrProvider implements OcrProvider {
  async recognizePage(request: OcrRequest): Promise<OcrResult> {
    if (!/^[a-z]{3}(\+[a-z]{3})*$/i.test(request.languages)) {
      throw new DocumentProcessingError('OCR_FAILED', 'Idiomas de OCR inválidos.');
    }
    if (!Number.isInteger(request.pageNumber) || request.pageNumber < 1) {
      throw new DocumentProcessingError('OCR_FAILED', 'Número de página inválido para OCR.');
    }

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fiscaliza-ocr-'));
    const imagePrefix = path.join(temporaryDirectory, 'page');
    const imagePath = `${imagePrefix}.png`;
    try {
      await execFileAsync(
        'pdftoppm',
        [
          '-f',
          String(request.pageNumber),
          '-l',
          String(request.pageNumber),
          '-singlefile',
          '-png',
          '-r',
          '300',
          request.pdfPath,
          imagePrefix,
        ],
        {
          timeout: request.timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          env: restrictedProcessEnvironment(),
        },
      );
      await readFile(imagePath);
      const result = await execFileAsync(
        'tesseract',
        [imagePath, 'stdout', '-l', request.languages, '--psm', '6'],
        {
          timeout: request.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          env: restrictedProcessEnvironment(),
        },
      );
      return { text: result.stdout.trim(), provider: 'tesseract-cli' };
    } catch (error) {
      throw new DocumentProcessingError(
        'OCR_FAILED',
        error instanceof Error ? error.message : 'Falha ao executar OCR.',
        true,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function restrictedProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL', 'TESSDATA_PREFIX'];
  return Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );
}
