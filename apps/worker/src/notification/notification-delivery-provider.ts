import { createHmacSignature, signaturePayload } from '@fiscaliza/shared';
import type { StructuredLogger } from '../logger';

export interface DeliveryDestination {
  phone: string;
  instance: string | null;
}

export interface DeliveryRequest {
  notificationId: string;
  idempotencyKey: string;
  notificationType: string;
  channel: 'WHATSAPP';
  destination: DeliveryDestination;
  payload: Record<string, unknown>;
}

export interface DeliveryResult {
  accepted: boolean;
  externalMessageId: string | null;
}

/**
 * Abstraction over the external delivery relay. The initial implementation
 * forwards signed webhooks to n8n (`N8N_WEBHOOK_BASE_URL`); n8n calls UAZAPI
 * with its own credentials and reports back through the delivery callback.
 * Fakes are only for development/tests and are rejected in production by the
 * config validation when WhatsApp is enabled.
 */
export interface NotificationDeliveryProvider {
  readonly name: string;
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

export interface N8nWebhookDeliveryProviderOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  logger: StructuredLogger;
}

export class N8nWebhookDeliveryProvider implements NotificationDeliveryProvider {
  readonly name = 'n8n';

  constructor(private readonly options: N8nWebhookDeliveryProviderOptions) {}

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const body = JSON.stringify({
      type: 'notification.delivery',
      notificationId: request.notificationId,
      idempotencyKey: request.idempotencyKey,
      notificationType: request.notificationType,
      channel: request.channel,
      destination: request.destination,
      payload: request.payload,
    });
    const timestamp = new Date().toISOString();
    const signature = createHmacSignature(this.options.secret, signaturePayload(timestamp, body));
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/notification-delivery`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fiscaliza-timestamp': timestamp,
          'x-fiscaliza-signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`n8n rejeitou a entrega (${response.status}): ${detail.slice(0, 200)}`);
      }
      let externalMessageId: string | null = null;
      const raw = await response.text().catch(() => '');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { externalMessageId?: unknown };
          if (typeof parsed.externalMessageId === 'string') {
            externalMessageId = parsed.externalMessageId;
          }
        } catch {
          this.options.logger.warn('Resposta do n8n sem JSON válido; entrega aceita.', {
            stage: 'notification-delivery',
          });
        }
      }
      return { accepted: true, externalMessageId };
    } finally {
      clearTimeout(timeout);
    }
  }
}
