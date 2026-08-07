import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function calculateSha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
