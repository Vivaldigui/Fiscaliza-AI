import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { DocumentProcessingError } from './errors';

const PDF_SIGNATURE = Buffer.from('%PDF-');

export interface ValidatedPdf {
  sizeBytes: number;
  sanitizedName: string;
  mimeType: 'application/pdf';
}

export async function validatePdfFile(
  filePath: string,
  originalName: string,
  maxSizeBytes: number,
): Promise<ValidatedPdf> {
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile() || metadata.size <= 0) {
    throw new DocumentProcessingError('DOCUMENT_CORRUPTED', 'O arquivo está vazio ou ilegível.');
  }
  if (metadata.size > maxSizeBytes) {
    throw new DocumentProcessingError(
      'DOCUMENT_TOO_LARGE',
      `O PDF excede o limite configurado de ${Math.floor(maxSizeBytes / 1024 / 1024)} MB.`,
    );
  }

  const sanitizedName = sanitizeOriginalName(originalName);
  if (path.extname(sanitizedName).toLowerCase() !== '.pdf') {
    throw new DocumentProcessingError(
      'INVALID_DOCUMENT_TYPE',
      'Somente arquivos com extensão .pdf são aceitos.',
    );
  }

  const handle = await open(filePath, 'r');
  try {
    const signature = Buffer.alloc(PDF_SIGNATURE.length);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead !== PDF_SIGNATURE.length || !signature.equals(PDF_SIGNATURE)) {
      throw new DocumentProcessingError(
        'INVALID_DOCUMENT_TYPE',
        'O conteúdo do arquivo não possui assinatura PDF válida.',
      );
    }
  } finally {
    await handle.close();
  }

  return { sizeBytes: metadata.size, sanitizedName, mimeType: 'application/pdf' };
}

export function sanitizeOriginalName(value: string): string {
  const base = path.basename(value || 'documento.pdf');
  const withoutControls = [...base.normalize('NFC')]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('');
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = cleaned || 'documento.pdf';
  if (fallback.length <= 255) return fallback;
  const extension = path.extname(fallback).slice(0, 10);
  return `${fallback.slice(0, 255 - extension.length)}${extension}`;
}
