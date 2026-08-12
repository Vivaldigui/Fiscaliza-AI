import {
  Injectable,
  PayloadTooLargeException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmacSignature, safeSignatureEqual, signaturePayload } from '@fiscaliza/shared';
import type { Request } from 'express';

interface SignedRequest extends Request {
  rawBody?: Buffer;
}

export const INTEGRATION_TIMESTAMP_HEADER = 'x-fiscaliza-timestamp';
export const INTEGRATION_SIGNATURE_HEADER = 'x-fiscaliza-signature';

/**
 * Authenticates webhooks from n8n to the backend (inbound messages and
 * delivery status callbacks).
 *
 * - HMAC-SHA256 over `timestamp.body` using `N8N_WEBHOOK_SECRET`;
 * - constant-time comparison;
 * - replay window of `WHATSAPP_INBOUND_MAX_AGE_SECONDS`;
 * - explicit body size limit (default JSON parser limit also applies);
 * - fail closed: without a configured secret the integration is unavailable.
 */
@Injectable()
export class IntegrationSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SignedRequest>();
    const secret = this.config.get<string>('N8N_WEBHOOK_SECRET');
    const maxAgeSeconds = this.config.getOrThrow<number>('WHATSAPP_INBOUND_MAX_AGE_SECONDS');
    const maxBodyBytes = this.config.getOrThrow<number>('WHATSAPP_INBOUND_MAX_BODY_BYTES');

    if (!secret) throw new UnauthorizedException('Integração externa não configurada.');

    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    if (rawBody.length > maxBodyBytes) {
      throw new PayloadTooLargeException('Corpo da mensagem acima do limite permitido.');
    }

    const timestamp = request.headers[INTEGRATION_TIMESTAMP_HEADER];
    const signature = request.headers[INTEGRATION_SIGNATURE_HEADER];
    if (typeof timestamp !== 'string' || typeof signature !== 'string') {
      throw new UnauthorizedException('Assinatura de integração ausente.');
    }

    const receivedAt = Date.parse(timestamp);
    if (Number.isNaN(receivedAt)) {
      throw new UnauthorizedException('Timestamp de integração inválido.');
    }
    if (Math.abs(Date.now() - receivedAt) > maxAgeSeconds * 1_000) {
      throw new UnauthorizedException('Timestamp de integração expirado.');
    }

    const expected = createHmacSignature(
      secret,
      signaturePayload(timestamp, rawBody.toString('utf8')),
    );
    const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    if (!safeSignatureEqual(received, expected)) {
      throw new UnauthorizedException('Assinatura de integração inválida.');
    }
    return true;
  }
}
