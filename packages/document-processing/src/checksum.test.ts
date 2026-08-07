import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateSha256 } from './checksum';

void describe('calculateSha256', () => {
  void it('produz checksum SHA-256 determinístico', () => {
    const first = calculateSha256(Buffer.from('documento fictício'));
    const second = calculateSha256(Buffer.from('documento fictício'));
    const different = calculateSha256(Buffer.from('outro documento'));
    assert.equal(first.length, 64);
    assert.equal(first, second);
    assert.notEqual(first, different);
  });
});
