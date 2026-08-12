import { z } from 'zod';
import { UNTRUSTED_DOCUMENT_RULE } from './base';

/**
 * Structured answer for the authorized web conversation (Fase 5A). The model
 * must echo `documentPageId` values exactly as provided in the delimited
 * context; the worker re-validates every id/excerpt against the retrieved,
 * authorized pages before persisting anything.
 */
export const webAnswerSchema = z.object({
  answer: z.string().min(1),
  sources: z
    .array(
      z.object({
        documentPageId: z.string().uuid(),
        pageNumber: z.number().int().positive(),
        excerpt: z.string().min(1).max(500).optional(),
      }),
    )
    .max(20),
});

export const webAnswerPromptV1 = {
  version: 'web-answer.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Responda em português claro e direto. Use somente o contexto autorizado recebido. Para afirmações factuais, cite exatamente o id de página fornecido ([PAGE id="..."]) e o número da página. Se as fontes autorizadas não forem suficientes para responder com segurança, declare explicitamente a insuficiência e retorne "sources" vazio. Nunca invente documento, página ou trecho que não esteja no contexto.`,
  schema: webAnswerSchema,
  schemaDescription: `{
  "answer": "resposta ao usuário em português",
  "sources": [
    {
      "documentPageId": "uuid de um [PAGE id=...] fornecido",
      "pageNumber": <número da página>,
      "excerpt": "trecho curto presente na página"
    }
  ]
}`,
};

export const INSUFFICIENT_EVIDENCE_ANSWER =
  'Não encontrei evidência suficiente nos documentos autorizados para responder com segurança.';
