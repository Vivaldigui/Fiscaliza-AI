import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeEmbeddingProvider } from './fake-embedding.provider';

void describe('FakeEmbeddingProvider', () => {
  void it('é determinístico e produz vetores de norma unitária', async () => {
    const provider = new FakeEmbeddingProvider();
    const first = await provider.embed({ inputs: ['proposição de lei'] });
    const second = await provider.embed({ inputs: ['proposição de lei'] });
    assert.deepEqual(first.embeddings, second.embeddings);
    assert.equal(first.embeddings[0]!.length, 1536);
    const norm = Math.sqrt(first.embeddings[0]!.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `norma esperada 1, obtida ${norm}`);
  });

  void it('produz vetores diferentes para entradas diferentes', async () => {
    const provider = new FakeEmbeddingProvider();
    const result = await provider.embed({ inputs: ['texto a', 'texto b'] });
    assert.notDeepEqual(result.embeddings[0], result.embeddings[1]);
  });

  void it('estima inputTokens pela contagem de caracteres', async () => {
    const provider = new FakeEmbeddingProvider();
    const result = await provider.embed({ inputs: ['12345678'] });
    assert.equal(result.usage.inputTokens, 2);
    assert.equal(result.usage.latencyMs, 0);
    assert.equal(result.provider, 'fake');
    assert.equal(result.model, 'fake-embedding-v1');
  });

  void it('respeita model e dimension configurados', async () => {
    const provider = new FakeEmbeddingProvider({ model: 'fake-teste', dimension: 8 });
    const result = await provider.embed({ inputs: ['short'] });
    assert.equal(result.model, 'fake-teste');
    assert.equal(result.embeddings[0]!.length, 8);
    assert.equal(result.dimension, 8);
  });
});
