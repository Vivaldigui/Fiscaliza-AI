import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type OpenAI from 'openai';
import { EMBEDDING_DIMENSION } from '../embeddings';
import { createEmbeddingProvider } from '../embedding-provider-factory';
import { OpenAIEmbeddingProvider } from './openai-embedding.provider';

/**
 * Asserts token mapping exactly while treating `latencyMs` as
 * environment-dependent: `Math.round(performance.now() - startedAt)` can be
 * 0 or 1 for an instant mocked completion depending on machine load.
 */
function assertUsage(
  actual: { inputTokens: number | null; latencyMs: number },
  inputTokens: number | null,
): void {
  assert.equal(actual.inputTokens, inputTokens);
  assert.ok(Number.isInteger(actual.latencyMs) && actual.latencyMs >= 0);
}

function stubEmbeddings(input: unknown, promptTokens?: number): OpenAI {
  return {
    embeddings: {
      create: async ({ input: texts }: { input: string | string[] }) => {
        const items = Array.isArray(texts) ? texts : [texts];
        return {
          data: items.map((_, index) => ({ embedding: [index + 1] })),
          usage: promptTokens === undefined ? undefined : { prompt_tokens: promptTokens },
        };
      },
    },
  } as unknown as OpenAI;
}

void describe('OpenAIEmbeddingProvider', () => {
  void it('devolve vetores e usage mapeados', async () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      dimension: 1536,
      client: stubEmbeddings(['texto um', 'texto dois'], 42),
    });
    const result = await provider.embed({ inputs: ['texto um', 'texto dois'] });
    assert.equal(result.embeddings.length, 2);
    assert.deepEqual(result.embeddings[0], [1]);
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'text-embedding-3-small');
    assert.equal(result.dimension, 1536);
    assertUsage(result.usage, 42);
  });

  void it('mapeia ausência de usage do provider para inputTokens null', async () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      dimension: 1536,
      client: stubEmbeddings(['texto']),
    });
    const result = await provider.embed({ inputs: ['texto'] });
    assert.equal(result.usage.inputTokens, null);
  });

  void it('recusa apiKey, model ou dimension inválidos no constructor', () => {
    assert.throws(
      () => new OpenAIEmbeddingProvider({ apiKey: '', model: 'm', dimension: 1536 }),
      /EMBEDDINGS_API_KEY/,
    );
    assert.throws(
      () => new OpenAIEmbeddingProvider({ apiKey: 'sk-test', model: '', dimension: 1536 }),
      /EMBEDDINGS_MODEL/,
    );
    assert.throws(
      () => new OpenAIEmbeddingProvider({ apiKey: 'sk-test', model: 'm', dimension: 0 }),
      /EMBEDDINGS_DIMENSION/,
    );
  });
});

void describe('createEmbeddingProvider', () => {
  void it('resolve o provider openai sem chamada de rede', () => {
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimension: EMBEDDING_DIMENSION,
      apiKey: 'sk-test',
    });
    assert.equal(provider.name, 'openai');
    assert.equal(provider.dimension, 1536);
  });

  void it('recusa openai sem EMBEDDINGS_API_KEY', () => {
    assert.throws(
      () =>
        createEmbeddingProvider({
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
        }),
      /EMBEDDINGS_API_KEY.*openai/,
    );
  });

  void it('recusa provider desconhecido', () => {
    assert.throws(
      () => createEmbeddingProvider({ provider: 'bogus', model: 'm', dimension: 1536 }),
      /não suportado/,
    );
  });
});
