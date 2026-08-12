import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type OpenAI from 'openai';
import { z } from 'zod';
import {
  type LLMTextResult,
  StructuredOutputValidationError,
  type StructuredGenerationRequest,
} from '../llm-provider';
import { createLLMProvider } from '../provider-factory';
import { OpenAIProvider } from './openai.provider';

const testSchema = z.object({ resultado: z.string() });

/**
 * Asserts token mapping exactly while treating `latencyMs` as
 * environment-dependent: `Math.round(performance.now() - startedAt)` can be
 * 0 or 1 for an instant mocked completion depending on machine load.
 */
function assertUsage(
  actual: { inputTokens: number | null; outputTokens: number | null; latencyMs: number },
  expectedTokens: { inputTokens: number | null; outputTokens: number | null },
): void {
  assert.deepEqual(
    { inputTokens: actual.inputTokens, outputTokens: actual.outputTokens },
    expectedTokens,
  );
  assert.ok(Number.isInteger(actual.latencyMs) && actual.latencyMs >= 0);
}

function buildRequest(
  overrides: Partial<StructuredGenerationRequest<typeof testSchema>> = {},
): StructuredGenerationRequest<typeof testSchema> {
  return {
    system: 'sistema',
    prompt: 'analise o documento',
    schema: testSchema,
    schemaDescription: '{ "resultado": "string" }',
    ...overrides,
  };
}

function stubCompletion(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content, role: 'assistant' } }],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        }),
      },
    },
  } as unknown as OpenAI;
}

void describe('OpenAIProvider', () => {
  void it('devolve dados e usage mapeados para JSON válido', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion('{"resultado":"ok"}'),
    });
    const result = await provider.generateStructured(buildRequest());
    assert.deepEqual(result.data, { resultado: 'ok' });
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-4o');
    assertUsage(result.usage, { inputTokens: 42, outputTokens: 7 });
  });

  void it('aceita JSON dentro de code fence', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion('```json\n{"resultado":"fence"}\n```'),
    });
    const result = await provider.generateStructured(buildRequest());
    assert.deepEqual(result.data, { resultado: 'fence' });
  });

  void it('lança StructuredOutputValidationError com o texto bruto quando o JSON é inválido', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion('isto não é json'),
    });
    await assert.rejects(
      provider.generateStructured(buildRequest()),
      (error: unknown) =>
        error instanceof StructuredOutputValidationError && error.rawOutput === 'isto não é json',
    );
  });

  void it('lança StructuredOutputValidationError quando a saída não casa o Zod', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion('{"campo_inesperado": 1}'),
    });
    await assert.rejects(
      provider.generateStructured(buildRequest()),
      (error: unknown) => error instanceof StructuredOutputValidationError,
    );
  });

  void it('lança quando o modelo não retorna conteúdo textual', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion(''),
    });
    await assert.rejects(provider.generateStructured(buildRequest()), /não retornou conteúdo/);
  });

  void it('mapeia ausência de usage para null', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '{"resultado":"ok"}' } }] }),
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o', client });
    const result = await provider.generateStructured(buildRequest());
    assertUsage(result.usage, { inputTokens: null, outputTokens: null });
  });

  void it('devolve o texto e o usage sem passar pelo schema', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      client: stubCompletion('resposta em linguagem natural'),
    });
    const result = (await provider.generateText({
      system: 'sistema',
      prompt: 'resuma o documento',
    })) as LLMTextResult;
    assert.equal(result.text, 'resposta em linguagem natural');
    assert.equal(result.provider, 'openai');
    assertUsage(result.usage, { inputTokens: 42, outputTokens: 7 });
  });

  void it('recusa apiKey ou model ausentes no constructor', () => {
    assert.throws(() => new OpenAIProvider({ apiKey: '', model: 'gpt-4o' }), /LLM_API_KEY/);
    assert.throws(() => new OpenAIProvider({ apiKey: 'sk-test', model: '' }), /LLM_MODEL/);
  });
});

void describe('createLLMProvider com openai', () => {
  void it('resolve o provider sem chamada de rede', () => {
    const provider = createLLMProvider({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    assert.equal(provider.name, 'openai');
    assert.equal(provider.model, 'gpt-4o');
  });

  void it('recusa openai sem LLM_API_KEY', () => {
    assert.throws(
      () => createLLMProvider({ provider: 'openai', model: 'gpt-4o' }),
      /LLM_API_KEY.*openai/,
    );
  });

  void it('recusa provider desconhecido', () => {
    assert.throws(() => createLLMProvider({ provider: 'bogus', model: 'x' }), /não suportado/);
  });
});
