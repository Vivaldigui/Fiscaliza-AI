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

/**
 * Thrown by a provider when the model's output fails JSON parsing or Zod
 * validation. Carries the raw (pre-validation) text so callers can pass it
 * back into a bounded repair/retry prompt without re-issuing a full request.
 */
export class StructuredOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'StructuredOutputValidationError';
  }
}
