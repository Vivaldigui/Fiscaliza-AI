import { z } from 'zod';

const confidenceSchema = z.number().min(0).max(1);

export const evidenceSchema = z
  .object({
    documentId: z.string().uuid(),
    pageNumber: z.number().int().positive(),
    excerpt: z.string().min(1).max(1200).optional(),
    reason: z.string().min(1).max(1200),
  })
  .strict();

export const requestAnalysisItemSchema = z
  .object({
    requestedItemId: z.string().uuid(),
    status: z.enum([
      'ANSWERED',
      'PARTIALLY_ANSWERED',
      'NOT_ANSWERED',
      'INCONCLUSIVE',
      'NOT_APPLICABLE',
      'NEEDS_HUMAN_REVIEW',
    ]),
    explanation: z.string().min(1).max(4000),
    confidence: confidenceSchema,
    evidences: z.array(evidenceSchema).max(20),
  })
  .strict();

export const requestAnalysisSchema = z
  .object({
    items: z.array(requestAnalysisItemSchema).min(1),
  })
  .strict();

export const indicationAnalysisItemSchema = z
  .object({
    requestedItemId: z.string().uuid(),
    status: z.enum([
      'ACCEPTED',
      'REJECTED',
      'UNDER_ANALYSIS',
      'ACTION_REPORTED',
      'EXECUTION_REPORTED',
      'NO_CLEAR_POSITION',
      'NEEDS_HUMAN_REVIEW',
    ]),
    explanation: z.string().min(1).max(4000),
    confidence: confidenceSchema,
    evidences: z.array(evidenceSchema).max(20),
  })
  .strict();

export const indicationAnalysisSchema = z
  .object({ items: z.array(indicationAnalysisItemSchema).min(1) })
  .strict();
