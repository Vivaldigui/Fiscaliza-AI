import type { z } from 'zod';
import {
  type LLMProvider,
  type LLMResult,
  type LLMTextResult,
  StructuredOutputValidationError,
  type StructuredGenerationRequest,
} from '../llm-provider';

type StructuredValue = unknown | (() => unknown | Promise<unknown>);
type TextValue = string | (() => string);

/**
 * Deterministic, in-process double for `LLMProvider`. No network call is
 * ever made, so it is safe to use in CI and in tests that must not depend on
 * an Anthropic credential. Responses are consumed in FIFO order per call
 * kind, mirroring how a real provider would be invoked once per LLM
 * interaction. `generateStructured` re-runs `schema.parse` on the queued
 * value exactly like a real provider's JSON-parse step would, so tests can
 * queue structurally invalid payloads to exercise repair/retry and
 * exhaustion paths.
 */
export class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model: string;
  private readonly structuredQueue: StructuredValue[] = [];
  private readonly textQueue: TextValue[] = [];
  private structuredCalls = 0;
  private textCalls = 0;

  constructor(config: { model?: string } = {}) {
    this.model = config.model ?? 'fake-deterministic-v1';
  }

  queueStructured(value: StructuredValue): this {
    this.structuredQueue.push(value);
    return this;
  }

  queueText(value: TextValue): this {
    this.textQueue.push(value);
    return this;
  }

  get structuredCallCount(): number {
    return this.structuredCalls;
  }

  get pendingStructuredCount(): number {
    return this.structuredQueue.length;
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<LLMResult<z.infer<TSchema>>> {
    this.structuredCalls += 1;
    const next = this.structuredQueue.shift();
    if (next === undefined) {
      throw new Error('FakeLLMProvider: fila de respostas estruturadas vazia para este teste.');
    }
    const raw =
      typeof next === 'function' ? await (next as () => unknown | Promise<unknown>)() : next;
    const validation = request.schema.safeParse(raw);
    if (!validation.success) {
      throw new StructuredOutputValidationError(
        `Saída não corresponde ao schema esperado: ${validation.error.message}`,
        JSON.stringify(raw),
      );
    }
    const data = validation.data as z.infer<TSchema>;
    return {
      data,
      usage: { inputTokens: 100, outputTokens: 50, latencyMs: 1 },
      provider: this.name,
      model: this.model,
    };
  }

  async generateText(): Promise<LLMTextResult> {
    this.textCalls += 1;
    const next = this.textQueue.shift();
    const text = typeof next === 'function' ? (next as () => string)() : (next ?? '');
    return {
      text,
      usage: { inputTokens: 20, outputTokens: text.length, latencyMs: 1 },
      provider: this.name,
      model: this.model,
    };
  }
}
