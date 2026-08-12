import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHmacSignature,
  maskPhone,
  normalizePhoneE164,
  phoneFingerprint,
  safeSignatureEqual,
  signaturePayload,
} from './whatsapp';

void describe('normalizePhoneE164', () => {
  void it('mantém número já em E.164', () => {
    assert.equal(normalizePhoneE164('+5535999999999'), '+5535999999999');
  });

  void it('remove separadores e assume país BR quando ausente', () => {
    assert.equal(normalizePhoneE164('(35) 99999-9999'), '+5535999999999');
    assert.equal(normalizePhoneE164('35 99999-9999'), '+5535999999999');
  });

  void it('rejeita entradas inválidas', () => {
    assert.equal(normalizePhoneE164(''), null);
    assert.equal(normalizePhoneE164('abc'), null);
    assert.equal(normalizePhoneE164('+1'), null);
  });
});

void describe('mascaramento e fingerprint', () => {
  void it('maskPhone expõe apenas prefixo curto e últimos dígitos', () => {
    assert.equal(maskPhone('+5535999999999'), '+55359***99');
  });

  void it('phoneFingerprint é determinístico e não contém o número', () => {
    const a = phoneFingerprint('+5535999999999');
    const b = phoneFingerprint('+5535999999999');
    const other = phoneFingerprint('+5535888888888');
    assert.equal(a, b);
    assert.notEqual(a, other);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

void describe('assinatura HMAC', () => {
  void it('gera e valida assinatura com comparação constante', () => {
    const secret = 'segredo-de-integracao';
    const payload = signaturePayload('2026-08-12T10:30:00Z', '{"ok":true}');
    const signature = createHmacSignature(secret, payload);
    assert.match(signature, /^[0-9a-f]{64}$/);
    assert.equal(safeSignatureEqual(signature, createHmacSignature(secret, payload)), true);
    assert.equal(safeSignatureEqual(signature, createHmacSignature('outro', payload)), false);
    assert.equal(safeSignatureEqual('a', 'abcdef'), false);
    assert.equal(safeSignatureEqual(signature.toUpperCase(), signature), false);
  });
});
