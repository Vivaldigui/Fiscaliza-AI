/**
 * Embedding provider abstraction — deliberately independent from `LLMProvider`:
 * nothing guarantees the vendor that generates text also generates vectors, so
 * chat/BFF providers and embedding providers have separate factories, config
 * and lifecycle. No domain code imports a provider SDK; it depends on this
 * interface and receives whichever implementation the factory returns.
 */
export interface EmbeddingUsage {
  inputTokens: number | null;
  latencyMs: number;
}

export interface EmbeddingRequest {
  inputs: string[];
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: EmbeddingUsage;
  provider: string;
  model: string;
  dimension: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimension: number;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
