import type { LLMProvider } from './llm-provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { FakeLLMProvider } from './providers/fake.provider';

export interface LLMProviderFactoryConfig {
  provider: string;
  model: string;
  apiKey?: string;
  defaultMaxTokens?: number;
}

/**
 * `LLM_PROVIDER=fake` is only meant for local development and CI, never for
 * a real analysis. Domain code never imports the Anthropic SDK directly;
 * it depends on `LLMProvider` and receives whichever implementation this
 * factory returns.
 */
export function createLLMProvider(config: LLMProviderFactoryConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.apiKey) throw new Error('LLM_API_KEY não configurada para o provider anthropic.');
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        ...(config.defaultMaxTokens !== undefined
          ? { defaultMaxTokens: config.defaultMaxTokens }
          : {}),
      });
    case 'fake':
      return new FakeLLMProvider({ model: config.model });
    default:
      throw new Error(`Provider de IA não suportado: ${config.provider}`);
  }
}
