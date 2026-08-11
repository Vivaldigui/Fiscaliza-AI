import { z } from 'zod';

const confidenceSchema = z.number().min(0).max(1);
const pageIdSchema = z.string().uuid();
const pageNumberSchema = z.number().int().positive();

/**
 * The model only ever sees opaque page IDs we inject into the prompt context
 * (see `pageDelimitedContentWithIds`). It cannot invent a `documentPageId`
 * that resolves to a real row; the backend re-validates every evidence
 * against the pages that were actually part of the analysis input.
 */
export const evidenceSchema = z
  .object({
    documentPageId: pageIdSchema,
    pageNumber: pageNumberSchema,
    excerpt: z.string().min(1).max(600).optional(),
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

const expectedAnswerTypeSchema = z.enum([
  'TEXT',
  'QUANTITY',
  'CURRENCY',
  'DATE',
  'LIST',
  'BOOLEAN',
  'DOCUMENT',
  'ACTION',
  'MIXED',
  'UNKNOWN',
]);

export const requestExtractionItemSchema = z
  .object({
    sequence: z.number().int().positive(),
    originalText: z.string().min(1).max(2000),
    normalizedQuestion: z.string().min(1).max(1000),
    category: z.string().min(1).max(100).optional(),
    expectedAnswerType: expectedAnswerTypeSchema,
    sourceDocumentPageId: pageIdSchema,
    sourcePageNumber: pageNumberSchema,
    confidence: confidenceSchema,
  })
  .strict();

export const requestExtractionSchema = z
  .object({
    items: z.array(requestExtractionItemSchema).min(1).max(100),
  })
  .strict();

export const indicationExtractionItemSchema = z
  .object({
    sequence: z.number().int().positive(),
    originalText: z.string().min(1).max(2000),
    normalizedQuestion: z.string().min(1).max(1000),
    category: z.string().min(1).max(100).optional(),
    expectedAnswerType: expectedAnswerTypeSchema,
    sourceDocumentPageId: pageIdSchema,
    sourcePageNumber: pageNumberSchema,
    confidence: confidenceSchema,
  })
  .strict();

export const indicationExtractionSchema = z
  .object({
    suggestedAction: z.string().min(1).max(1000),
    location: z.string().min(1).max(500).optional(),
    object: z.string().min(1).max(1000).optional(),
    justification: z.string().min(1).max(2000).optional(),
    items: z.array(indicationExtractionItemSchema).min(1).max(50),
  })
  .strict();

export const executiveSummarySchema = z
  .object({
    summary: z.string().min(1).max(4000),
    mainFindings: z
      .array(
        z
          .object({
            text: z.string().min(1).max(1000),
            analysisItemIds: z.array(z.string().uuid()).min(1),
          })
          .strict(),
      )
      .max(30),
    pendingItems: z.array(z.string().min(1).max(1000)).max(30),
    importantNumbers: z
      .array(
        z
          .object({
            label: z.string().min(1).max(200),
            value: z.string().min(1).max(200),
            evidenceId: z.string().uuid().optional(),
          })
          .strict(),
      )
      .max(30),
    importantDates: z
      .array(
        z
          .object({
            label: z.string().min(1).max(200),
            value: z.string().min(1).max(200),
            evidenceId: z.string().uuid().optional(),
          })
          .strict(),
      )
      .max(30),
    mentionedEntities: z.array(z.string().min(1).max(300)).max(30),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;
export type RequestAnalysisItem = z.infer<typeof requestAnalysisItemSchema>;
export type RequestAnalysis = z.infer<typeof requestAnalysisSchema>;
export type IndicationAnalysisItem = z.infer<typeof indicationAnalysisItemSchema>;
export type IndicationAnalysis = z.infer<typeof indicationAnalysisSchema>;
export type RequestExtractionItem = z.infer<typeof requestExtractionItemSchema>;
export type RequestExtraction = z.infer<typeof requestExtractionSchema>;
export type IndicationExtractionItem = z.infer<typeof indicationExtractionItemSchema>;
export type IndicationExtraction = z.infer<typeof indicationExtractionSchema>;
export type ExecutiveSummary = z.infer<typeof executiveSummarySchema>;
