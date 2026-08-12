import { PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmacSignature, signaturePayload } from '@fiscaliza/shared';
import { IntegrationSignatureGuard } from './whatsapp-signature.guard';

const secret = 'segredo-compartilhado-n8n-1234567890';
const body = JSON.stringify({ messageId: 'wamid.1', text: 'oi' });
const timestamp = new Date(Date.now() - 5_000).toISOString();
const signature = createHmacSignature(secret, signaturePayload(timestamp, body));

function buildGuard() {
  const config = {
    get: jest.fn((key: string) => (key === 'N8N_WEBHOOK_SECRET' ? secret : undefined)),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'WHATSAPP_INBOUND_MAX_AGE_SECONDS') return 300;
      if (key === 'WHATSAPP_INBOUND_MAX_BODY_BYTES') return 16_384;
      return 0;
    }),
  } as unknown as ConfigService;
  return new IntegrationSignatureGuard(config);
}

function context(request: {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('IntegrationSignatureGuard', () => {
  it('aceita assinatura válida dentro da janela', () => {
    const guard = buildGuard();
    const result = guard.canActivate(
      context({
        headers: {
          'x-fiscaliza-timestamp': timestamp,
          'x-fiscaliza-signature': `sha256=${signature}`,
        },
        rawBody: Buffer.from(body),
      }),
    );
    expect(result).toBe(true);
  });

  it('rejeita assinatura inválida (cenário 2)', () => {
    const guard = buildGuard();
    expect(() =>
      guard.canActivate(
        context({
          headers: {
            'x-fiscaliza-timestamp': timestamp,
            'x-fiscaliza-signature': 'sha256=deadbeef',
          },
          rawBody: Buffer.from(body),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejeita timestamp expirado (cenário 3)', () => {
    const guard = buildGuard();
    const oldTimestamp = new Date(Date.now() - 400_000).toISOString();
    const oldSignature = createHmacSignature(secret, signaturePayload(oldTimestamp, body));
    expect(() =>
      guard.canActivate(
        context({
          headers: {
            'x-fiscaliza-timestamp': oldTimestamp,
            'x-fiscaliza-signature': `sha256=${oldSignature}`,
          },
          rawBody: Buffer.from(body),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejeita ausência de cabeçalhos', () => {
    const guard = buildGuard();
    expect(() => guard.canActivate(context({ headers: {}, rawBody: Buffer.from(body) }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita corpo acima do limite', () => {
    const guard = buildGuard();
    const bigBody = JSON.stringify({ text: 'x'.repeat(20_000) });
    const bigTimestamp = new Date().toISOString();
    const bigSignature = createHmacSignature(secret, signaturePayload(bigTimestamp, bigBody));
    expect(() =>
      guard.canActivate(
        context({
          headers: {
            'x-fiscaliza-timestamp': bigTimestamp,
            'x-fiscaliza-signature': `sha256=${bigSignature}`,
          },
          rawBody: Buffer.from(bigBody),
        }),
      ),
    ).toThrow(PayloadTooLargeException);
  });

  it('falha fechado sem segredo configurado', () => {
    const config = {
      get: jest.fn(() => undefined),
      getOrThrow: jest.fn(() => 300),
    } as unknown as ConfigService;
    const guard = new IntegrationSignatureGuard(config);
    expect(() => guard.canActivate(context({ headers: {}, rawBody: Buffer.from(body) }))).toThrow(
      UnauthorizedException,
    );
  });
});
