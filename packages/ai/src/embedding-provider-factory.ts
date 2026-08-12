import type { EmbeddingProvider } from './embedding-provider';
import { FakeEmbeddingProvider } from './providers/fake-embedding.provider';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider';

export interface EmbeddingProviderFactoryConfig {
  provider: string;
  model: string;
  dimension: number;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * `EMBEDDINGS_PROVIDER=fake` is only meant for local development and CI, never
 * for real indexing. Domain code never imports a provider SDK directly; it
 * depends on `EmbeddingProvider` and receives whichever implementation this
 * factory returns.
 */
export function createEmbeddingProvider(config: EmbeddingProviderFactoryConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('EMBEDDINGS_API_KEY não configurada para o provider openai.');
      }
      return new OpenAIEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        dimension: config.dimension,
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      });
    case 'fake':
      return new FakeEmbeddingProvider({ model: config.model, dimension: config.dimension });
    default:
      throw new Error(`Provider de embeddings não suportado: ${config.provider}`);
  }
}
