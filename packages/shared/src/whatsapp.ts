import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phone + webhook-signature helpers shared by the API (inbound, callbacks and
 * admin endpoints) and the worker (n8n delivery provider). Framework-free.
 *
 * Phones are normalized to E.164 (`+<country><number>`) and never stored or
 * logged in full: the inbound envelope keeps only the SHA-256 hash, and logs /
 * API responses use `maskPhone` (first three digits + last two).
 */

const DIGITS = /^\+?(\d{10,15})$/;

/** Converts a raw inbound phone to E.164, or returns null when ambiguous/invalid. */
export function normalizePhoneE164(input: string): string | null {
  const cleaned = input.replace(/[\s().-]/g, '');
  const match = DIGITS.exec(cleaned);
  if (!match || match[1] === undefined) return null;
  const digits = match[1];
  if (cleaned.startsWith('+')) return `+${digits}`;
  // Brazilian numbers without country code: DDD + local number (10–11 digits).
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return null;
}

/** Masks all but the first three and last two digits: `+5535***99`. */
export function maskPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length <= 5) return '****';
  return `+${cleaned.slice(0, 2)}${cleaned.slice(2, 5)}***${cleaned.slice(-2)}`;
}

/** SHA-256 hex of the normalized phone — the only representation persisted. */
export function phoneFingerprint(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

/** Canonical signature input: `timestamp.body`. */
export function signaturePayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export function createHmacSignature(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** Constant-time comparison of two hex signatures (always false on mismatch). */
export function safeSignatureEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WhatsappSession {
  activePropositionId: string | null;
  conversationId: string | null;
  lastInteraction: string;
}

export function whatsappSessionKey(instance: string, identityId: string): string {
  return `whatsapp:session:${instance}:${identityId}`;
}
