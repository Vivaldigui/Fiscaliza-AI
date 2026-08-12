import OpenAI from 'openai';
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from '../embedding-provider';

export interface OpenAIEmbeddingProviderConfig {
  apiKey: string;
  model: string;
  dimension: number;
  timeoutMs?: number;
  /**
   * Injected client, primarily so tests can stub `embeddings.create` without
   * network access. Defaults to `new OpenAI({ apiKey, timeout: timeoutMs })`.
   */
  client?: OpenAI;
}

/**
 * OpenAI implementation of `EmbeddingProvider`. The dimension is pinned in
 * config and always passed to the API (`dimensions`), so switching between
 * `text-embedding-3-small` (native 1536) and `text-embedding-3-large` (also
 * exposed at 1536 via the parameter) never changes the physical column.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimension: number;
  private readonly client: OpenAI;

  constructor(config: OpenAIEmbeddingProviderConfig) {
    if (!config.apiKey) throw new Error('EMBEDDINGS_API_KEY não configurada');
    if (!config.model) throw new Error('EMBEDDINGS_MODEL não configurado');
    if (!Number.isInteger(config.dimension) || config.dimension <= 0) {
      throw new Error('EMBEDDINGS_DIMENSION inválida');
    }
    this.model = config.model;
    this.dimension = config.dimension;
    this.client = config.client ?? new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const startedAt = performance.now();
    const completion = await this.client.embeddings.create({
      model: this.model,
      input: request.inputs,
      dimensions: this.dimension,
    });
    return {
      embeddings: completion.data.map((item) => item.embedding),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? null,
        latencyMs: Math.round(performance.now() - startedAt),
      },
      provider: this.name,
      model: this.model,
      dimension: this.dimension,
    };
  }
}
