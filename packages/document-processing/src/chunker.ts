import { calculateSha256 } from './checksum';

export interface ChunkConfig {
  size: number;
  overlap: number;
}

export interface TextChunk {
  sequence: number;
  content: string;
  contentHash: string;
}

export class TextChunker {
  constructor(private readonly config: ChunkConfig) {
    if (config.size < 100) throw new Error('DOCUMENT_CHUNK_SIZE deve ser ao menos 100.');
    if (config.overlap < 0 || config.overlap >= config.size) {
      throw new Error('DOCUMENT_CHUNK_OVERLAP deve estar entre 0 e o tamanho do chunk.');
    }
  }

  chunkPage(input: string): TextChunk[] {
    const text = input.replace(/\r\n/g, '\n').trim();
    if (!text) return [];
    const units = semanticUnits(text);
    const chunks: string[] = [];
    let current = '';

    for (const unit of units) {
      if (unit.length > this.config.size) {
        if (current) chunks.push(current.trim());
        current = '';
        chunks.push(...sliceWithOverlap(unit, this.config));
        continue;
      }
      const candidate = current ? `${current}\n\n${unit}` : unit;
      if (candidate.length <= this.config.size) {
        current = candidate;
      } else {
        chunks.push(current.trim());
        const carry = this.config.overlap ? tail(current, this.config.overlap) : '';
        current = carry ? `${carry}\n\n${unit}` : unit;
        if (current.length > this.config.size) {
          chunks.push(...sliceWithOverlap(current, this.config));
          current = '';
        }
      }
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks.filter(Boolean).map((content, sequence) => ({
      sequence,
      content,
      contentHash: calculateSha256(Buffer.from(content, 'utf8')),
    }));
  }
}

function semanticUnits(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const lines = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return (
    text
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? [text]
  );
}

function sliceWithOverlap(text: string, config: ChunkConfig): string[] {
  const chunks: string[] = [];
  const step = config.size - config.overlap;
  for (let index = 0; index < text.length; index += step) {
    const chunk = text.slice(index, index + config.size).trim();
    if (chunk) chunks.push(chunk);
    if (index + config.size >= text.length) break;
  }
  return chunks;
}

function tail(value: string, size: number): string {
  return value.slice(Math.max(0, value.length - size)).trimStart();
}
