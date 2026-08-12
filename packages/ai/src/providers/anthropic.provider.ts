import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { extractJson } from '../extract-json';
import {
  type LLMProvider,
  type LLMResult,
  type LLMTextResult,
  StructuredOutputValidationError,
  type StructuredGenerationRequest,
  type TextGenerationRequest,
} from '../llm-provider';

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  defaultMaxTokens?: number;
  /** Request timeout in ms; mirrors EMBEDDINGS_TIMEOUT_MS for embeddings. */
  timeoutMs?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) throw new Error('LLM_API_KEY não configurada');
    if (!config.model) throw new Error('LLM_MODEL não configurado');
    this.model = config.model;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<LLMResult<z.infer<TSchema>>> {
    const result = await this.createMessage({
      ...request,
      prompt: `${request.prompt}\n\nRetorne somente JSON válido conforme este contrato:\n${request.schemaDescription}`,
    });
    const jsonText = extractJson(result.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new StructuredOutputValidationError(
        `JSON inválido retornado pelo provider: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        jsonText,
      );
    }
    const validation = request.schema.safeParse(parsed);
    if (!validation.success) {
      throw new StructuredOutputValidationError(
        `Saída não corresponde ao schema esperado: ${validation.error.message}`,
        jsonText,
      );
    }
    return {
      data: validation.data as z.infer<TSchema>,
      usage: result.usage,
      provider: this.name,
      model: this.model,
    };
  }

  async generateText(request: TextGenerationRequest): Promise<LLMTextResult> {
    const result = await this.createMessage(request);
    return { ...result, provider: this.name, model: this.model };
  }

  private async createMessage(request: TextGenerationRequest): Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number; latencyMs: number };
  }> {
    const startedAt = performance.now();
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? 0,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    if (!text) throw new Error('Provider não retornou conteúdo textual');
    return {
      text,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}
