import { createHash } from 'node:crypto';

export function calculateSha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
