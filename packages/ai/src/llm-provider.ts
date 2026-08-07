import type { z } from 'zod';

export interface StructuredGenerationRequest<TSchema extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: TSchema;
  schemaDescription: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TextGenerationRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface LLMResult<T> {
  data: T;
  usage: LLMUsage;
  provider: string;
  model: string;
}

export interface LLMTextResult {
  text: string;
  usage: LLMUsage;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<LLMResult<z.infer<TSchema>>>;
  generateText(request: TextGenerationRequest): Promise<LLMTextResult>;
}
