import { createHash } from 'node:crypto';
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from '../embedding-provider';

export interface FakeEmbeddingProviderConfig {
  model?: string;
  dimension?: number;
}

/**
 * Deterministic, in-process double for tests and CI. The same input always
 * produces the same (unit-norm) vector, so fixture-based similarity tests are
 * stable across runs and processes. Never used in production: the worker's
 * environment validation rejects `EMBEDDINGS_PROVIDER=fake` when
 * `NODE_ENV=production` and `EMBEDDINGS_ENABLED=true`.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake';
  readonly model: string;
  readonly dimension: number;

  constructor(config: FakeEmbeddingProviderConfig = {}) {
    this.model = config.model ?? 'fake-embedding-v1';
    this.dimension = config.dimension ?? 1536;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const embeddings = request.inputs.map((input) => {
      const hash = createHash('sha256').update(input, 'utf8').digest('hex');
      return seededUnitVector(hash, this.dimension);
    });
    return {
      embeddings,
      usage: {
        inputTokens: request.inputs.reduce((sum, input) => sum + Math.ceil(input.length / 4), 0),
        latencyMs: 0,
      },
      provider: this.name,
      model: this.model,
      dimension: this.dimension,
    };
  }
}

function seededUnitVector(seedHex: string, dimension: number): number[] {
  let seed = 0;
  for (let i = 0; i < 16; i++) seed = (seed * 31 + seedHex.charCodeAt(i * 2)) >>> 0;
  const next = (): number => {
    seed ^= (seed << 13) >>> 0;
    seed ^= seed >>> 17;
    seed ^= (seed << 5) >>> 0;
    return seed / 0xffffffff;
  };
  const vector = new Array<number>(dimension);
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    const value = next() - 0.5;
    vector[i] = value;
    norm += value * value;
  }
  const scale = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimension; i++) vector[i] = vector[i]! / scale;
  return vector;
}
