import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeEmbeddingHash,
  EMBEDDING_DIMENSION,
  embedInBatches,
  embeddingsPerTerm,
} from './embeddings';
import { FakeEmbeddingProvider } from './providers/fake-embedding.provider';

void describe('computeEmbeddingHash', () => {
  const base = { content: 'texto', provider: 'openai', model: 'm', dimension: 1536, version: 'v1' };

  void it('é determinística e estável entre invocações', () => {
    const a = computeEmbeddingHash(
      ...(Object.values(base) as [string, string, string, number, string]),
    );
    const b = computeEmbeddingHash(
      ...(Object.values(base) as [string, string, string, number, string]),
    );
    assert.equal(a, b);
  });

  void it('muda quando qualquer fator muda', () => {
    const keys = ['content', 'provider', 'model', 'dimension', 'version'] as const;
    for (const key of keys) {
      const altered = { ...base, [key]: key === 'dimension' ? 8 : `${base[key]}-alienado` };
      assert.notEqual(
        computeEmbeddingHash(
          altered.content,
          altered.provider as string,
          altered.model,
          altered.dimension,
          altered.version,
        ),
        computeEmbeddingHash(
          base.content,
          base.provider as string,
          base.model,
          base.dimension,
          base.version,
        ),
        `esperava hashes diferentes ao mudar ${key}`,
      );
    }
  });
});

void describe('embeddingsPerTerm', () => {
  void it('soma ceil(len/4) por entrada', () => {
    assert.equal(embeddingsPerTerm(['12345678', 'abc', '']), 2 + 1 + 0);
  });
});

void describe('embedInBatches', () => {
  void it('faz curto-circuito com entradas vazias', async () => {
    const result = await embedInBatches(new FakeEmbeddingProvider(), [], 2);
    assert.deepEqual(result, { vectors: [], inputTokens: null, latencyMs: 0, batchCount: 0 });
  });

  void it('divide em lotes e agrega usage', async () => {
    const inputs = ['um', 'dois', 'tres', 'quatro', 'cinco'];
    const result = await embedInBatches(new FakeEmbeddingProvider(), inputs, 2);
    assert.equal(result.vectors.length, 5);
    assert.equal(result.batchCount, 3);
    assert.equal(result.vectors[0]!.length, EMBEDDING_DIMENSION);
    assert.ok(result.inputTokens! > 0);
  });

  void it('propaga null quando algum lote não reporta tokens', async () => {
    let batchIndex = 0;
    const provider = {
      name: 'stub',
      model: 'm',
      dimension: 8,
      embed: async ({ inputs }: { inputs: string[] }) => {
        batchIndex += 1;
        return {
          embeddings: inputs.map(() => []),
          usage: { inputTokens: batchIndex === 2 ? null : 1, latencyMs: 0 },
          provider: 'stub',
          model: 'm',
          dimension: 8,
        };
      },
    };
    const result = await embedInBatches(provider, ['a', 'b', 'c'], 2);
    assert.equal(result.inputTokens, null);
    assert.equal(result.batchCount, 2);
  });
});
