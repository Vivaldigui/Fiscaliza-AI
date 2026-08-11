import OpenAI from 'openai';
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

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  defaultMaxTokens?: number;
  /**
   * Injected client, primarily so tests can stub `chat.completions.create`
   * without any network access. Defaults to `new OpenAI({ apiKey })`.
   */
  client?: OpenAI;
}

/**
 * OpenAI (GPT) implementation of `LLMProvider`. Deliberately mirrors
 * `AnthropicProvider`: the same prompt-driven contract ("return only JSON"),
 * the same `extractJson` + `JSON.parse` + Zod validation, and the same
 * `StructuredOutputValidationError` so the pipeline's bounded repair/retry
 * path behaves identically regardless of which real provider is configured.
 *
 * `temperature: 0` mirrors the Anthropic provider. If a future model choice is
 * a reasoning model that rejects `temperature` or `max_tokens` on the chat
 * API, adjust this provider when that model is actually selected — do not add
 * provider-specific prompt changes here.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly defaultMaxTokens: number;

  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey) throw new Error('LLM_API_KEY não configurada');
    if (!config.model) throw new Error('LLM_MODEL não configurado');
    this.model = config.model;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.client = config.client ?? new OpenAI({ apiKey: config.apiKey });
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<LLMResult<z.infer<TSchema>>> {
    const result = await this.createCompletion({
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
    const result = await this.createCompletion(request);
    return { ...result, provider: this.name, model: this.model };
  }

  private async createCompletion(request: TextGenerationRequest): Promise<{
    text: string;
    usage: { inputTokens: number | null; outputTokens: number | null; latencyMs: number };
  }> {
    const startedAt = performance.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? 0,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    });
    const text = completion.choices[0]?.message.content?.trim() ?? '';
    if (!text) throw new Error('Provider não retornou conteúdo textual');
    return {
      text,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? null,
        outputTokens: completion.usage?.completion_tokens ?? null,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}
