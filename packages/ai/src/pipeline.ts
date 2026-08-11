import type { z } from 'zod';
import { StructuredOutputValidationError, type LLMProvider, type LLMUsage } from './llm-provider';
import { type IdentifiedPage, pageDelimitedContentWithIds } from './prompts/base';
import {
  executiveSummaryPromptV1,
  indicationAnalysisPromptV1,
  indicationExtractionPromptV1,
  requestAnalysisPromptV1,
  requestExtractionPromptV1,
} from './prompts';
import {
  type Evidence,
  type ExecutiveSummary,
  executiveSummarySchema,
  type IndicationAnalysisItem,
  indicationAnalysisSchema,
  type IndicationExtraction,
  indicationExtractionSchema,
  type RequestAnalysisItem,
  requestAnalysisSchema,
  type RequestExtraction,
  requestExtractionSchema,
} from './schemas/analysis.schemas';

export type PipelinePage = IdentifiedPage;

export interface UsageEvent {
  operation: string;
  usage: LLMUsage;
  attempt: number;
}

export class AiValidationExhaustedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly lastError: string,
    public readonly attempts: number,
  ) {
    super(
      `Falha ao validar saída estruturada de "${operation}" após ${attempts} tentativa(s): ${lastError}`,
    );
    this.name = 'AiValidationExhaustedError';
  }
}

export function batchPages(pages: PipelinePage[], maxPerBatch: number): PipelinePage[][] {
  if (pages.length === 0) return [];
  const size = Math.max(1, maxPerBatch);
  const batches: PipelinePage[][] = [];
  for (let index = 0; index < pages.length; index += size)
    batches.push(pages.slice(index, index + size));
  return batches;
}

async function callStructuredWithRetry<TSchema extends z.ZodTypeAny>(params: {
  provider: LLMProvider;
  system: string;
  buildPrompt: (repair?: { previousOutput: string; error: string }) => string;
  schema: TSchema;
  schemaDescription: string;
  maxRetries: number;
  operation: string;
  usageSink: UsageEvent[];
}): Promise<z.infer<TSchema>> {
  let lastError = '';
  let lastOutput = '';
  for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
    const prompt = params.buildPrompt(
      attempt > 0 ? { previousOutput: lastOutput, error: lastError } : undefined,
    );
    try {
      const result = await params.provider.generateStructured({
        system: params.system,
        prompt,
        schema: params.schema,
        schemaDescription: params.schemaDescription,
      });
      params.usageSink.push({ operation: params.operation, usage: result.usage, attempt });
      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Falha desconhecida ao validar saída.';
      lastOutput = error instanceof StructuredOutputValidationError ? error.rawOutput : '';
      if (attempt === params.maxRetries) {
        throw new AiValidationExhaustedError(params.operation, lastError, attempt + 1);
      }
    }
  }
  throw new AiValidationExhaustedError(params.operation, lastError, params.maxRetries + 1);
}

function repairSuffix(repair?: { previousOutput: string; error: string }): string {
  if (!repair) return '';
  return `\n\nA tentativa anterior falhou na validação estrutural. Erro: ${repair.error}\nCorrija e retorne novamente somente o JSON válido, sem repetir o erro.`;
}

// ---------------------------------------------------------------------------
// Extraction (REQUEST_EXTRACTION / INDICATION_EXTRACTION)
// ---------------------------------------------------------------------------

export interface ExtractionOutcome<TItem> {
  items: TItem[];
  rejectedForInventedPage: number;
  usage: UsageEvent[];
}

export async function extractRequestItems(params: {
  provider: LLMProvider;
  pages: PipelinePage[];
  maxPagesPerBatch: number;
  maxRetries: number;
}): Promise<ExtractionOutcome<RequestExtraction['items'][number]>> {
  const usage: UsageEvent[] = [];
  const validPageIds = new Set(params.pages.map((page) => page.documentPageId));
  const batches = batchPages(params.pages, params.maxPagesPerBatch);
  const collected: RequestExtraction['items'] = [];
  let rejected = 0;
  let sequence = 1;

  for (const batch of batches) {
    const context = pageDelimitedContentWithIds(batch);
    const data = await callStructuredWithRetry({
      provider: params.provider,
      system: requestExtractionPromptV1.system,
      buildPrompt: (repair) =>
        `Extraia cada solicitação verificável deste trecho do requerimento. Use apenas os documentPageId presentes abaixo.\n\n${context}${repairSuffix(repair)}`,
      schema: requestExtractionSchema,
      schemaDescription:
        'requestExtractionSchema (items[]: sequence, originalText, normalizedQuestion, category?, expectedAnswerType, sourceDocumentPageId, sourcePageNumber, confidence)',
      maxRetries: params.maxRetries,
      operation: 'request-extraction',
      usageSink: usage,
    });
    for (const item of data.items) {
      if (!validPageIds.has(item.sourceDocumentPageId)) {
        rejected += 1;
        continue;
      }
      collected.push({ ...item, sequence });
      sequence += 1;
    }
  }
  return { items: collected, rejectedForInventedPage: rejected, usage };
}

export async function extractIndicationItems(params: {
  provider: LLMProvider;
  pages: PipelinePage[];
  maxPagesPerBatch: number;
  maxRetries: number;
}): Promise<{
  suggestedAction: string;
  location?: string;
  object?: string;
  justification?: string;
  items: IndicationExtraction['items'];
  rejectedForInventedPage: number;
  usage: UsageEvent[];
}> {
  const usage: UsageEvent[] = [];
  const validPageIds = new Set(params.pages.map((page) => page.documentPageId));
  const batches = batchPages(params.pages, params.maxPagesPerBatch);
  const collected: IndicationExtraction['items'] = [];
  let rejected = 0;
  let sequence = 1;
  let suggestedAction = '';
  let location: string | undefined;
  let object: string | undefined;
  let justification: string | undefined;

  for (const batch of batches) {
    const context = pageDelimitedContentWithIds(batch);
    const data = await callStructuredWithRetry({
      provider: params.provider,
      system: indicationExtractionPromptV1.system,
      buildPrompt: (repair) =>
        `Extraia a estrutura desta indicação a partir do trecho abaixo. Use apenas os documentPageId presentes.\n\n${context}${repairSuffix(repair)}`,
      schema: indicationExtractionSchema,
      schemaDescription:
        'indicationExtractionSchema (suggestedAction, location?, object?, justification?, items[])',
      maxRetries: params.maxRetries,
      operation: 'indication-extraction',
      usageSink: usage,
    });
    if (!suggestedAction) suggestedAction = data.suggestedAction;
    location ??= data.location;
    object ??= data.object;
    justification ??= data.justification;
    for (const item of data.items) {
      if (!validPageIds.has(item.sourceDocumentPageId)) {
        rejected += 1;
        continue;
      }
      collected.push({ ...item, sequence });
      sequence += 1;
    }
  }
  return {
    suggestedAction,
    ...(location !== undefined ? { location } : {}),
    ...(object !== undefined ? { object } : {}),
    ...(justification !== undefined ? { justification } : {}),
    items: collected,
    rejectedForInventedPage: rejected,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Cumulative response analysis (REQUEST_RESPONSE / INDICATION_RESPONSE)
// ---------------------------------------------------------------------------

const REQUEST_STATUS_PRIORITY: Record<string, number> = {
  ANSWERED: 0,
  PARTIALLY_ANSWERED: 1,
  INCONCLUSIVE: 2,
  NEEDS_HUMAN_REVIEW: 3,
  NOT_APPLICABLE: 4,
  NOT_ANSWERED: 5,
};

const INDICATION_STATUS_PRIORITY: Record<string, number> = {
  EXECUTION_REPORTED: 0,
  ACTION_REPORTED: 1,
  ACCEPTED: 2,
  REJECTED: 2,
  UNDER_ANALYSIS: 3,
  NEEDS_HUMAN_REVIEW: 4,
  NO_CLEAR_POSITION: 5,
};

function mergeItem<TStatus extends string>(
  perBatch: Array<{
    requestedItemId: string;
    status: TStatus;
    explanation: string;
    confidence: number;
    evidences: Evidence[];
  }>,
  priority: Record<string, number>,
): {
  requestedItemId: string;
  status: TStatus;
  explanation: string;
  confidence: number;
  evidences: Evidence[];
} {
  const rank = (status: TStatus) => priority[status] ?? Number.MAX_SAFE_INTEGER;
  const best = perBatch.reduce((a, b) => (rank(a.status) <= rank(b.status) ? a : b));
  const winners = perBatch.filter((entry) => entry.status === best.status);
  const explanation = [...new Set(winners.map((w) => w.explanation.trim()).filter(Boolean))].join(
    ' ',
  );
  const confidence = Math.min(...winners.map((w) => w.confidence));
  const evidences = winners.flatMap((w) => w.evidences);
  return {
    requestedItemId: best.requestedItemId,
    status: best.status,
    explanation,
    confidence,
    evidences,
  };
}

function fillMissingItems<TStatus extends string>(
  itemIds: string[],
  batchResult: Array<{
    requestedItemId: string;
    status: TStatus;
    explanation: string;
    confidence: number;
    evidences: Evidence[];
  }>,
  fallbackStatus: TStatus,
): Array<{
  requestedItemId: string;
  status: TStatus;
  explanation: string;
  confidence: number;
  evidences: Evidence[];
}> {
  const present = new Set(batchResult.map((entry) => entry.requestedItemId));
  const missing = itemIds
    .filter((id) => !present.has(id))
    .map((id) => ({
      requestedItemId: id,
      status: fallbackStatus,
      explanation: 'Nenhuma informação relevante localizada neste lote de páginas.',
      confidence: 0.5,
      evidences: [] as Evidence[],
    }));
  return [...batchResult, ...missing];
}

export interface AnalysisInputItem {
  id: string;
  normalizedQuestion: string;
}

export async function analyzeRequestResponses(params: {
  provider: LLMProvider;
  items: AnalysisInputItem[];
  pages: PipelinePage[];
  maxPagesPerBatch: number;
  maxRetries: number;
}): Promise<{ items: RequestAnalysisItem[]; usage: UsageEvent[] }> {
  const usage: UsageEvent[] = [];
  const batches = batchPages(params.pages, params.maxPagesPerBatch);
  const validPageIds = new Set(params.pages.map((page) => page.documentPageId));
  const perItemBatches = new Map<string, RequestAnalysisItem[]>();

  for (const batch of batches) {
    const context = pageDelimitedContentWithIds(batch);
    const itemsList = params.items
      .map((item) => `- id="${item.id}": ${item.normalizedQuestion}`)
      .join('\n');
    const data = await callStructuredWithRetry({
      provider: params.provider,
      system: requestAnalysisPromptV1.system,
      buildPrompt: (repair) =>
        `Itens solicitados a avaliar neste lote (retorne uma entrada para cada um, mesmo que NOT_ANSWERED):\n${itemsList}\n\nPáginas deste lote:\n${context}${repairSuffix(repair)}`,
      schema: requestAnalysisSchema,
      schemaDescription:
        'requestAnalysisSchema (items[]: requestedItemId, status, explanation, confidence, evidences[])',
      maxRetries: params.maxRetries,
      operation: 'request-analysis',
      usageSink: usage,
    });
    const validated = data.items.filter((item) =>
      params.items.some((requested) => requested.id === item.requestedItemId),
    );
    const filled = fillMissingItems(
      params.items.map((item) => item.id),
      validated,
      'NOT_ANSWERED' as RequestAnalysisItem['status'],
    );
    for (const item of filled) {
      const sanitized: RequestAnalysisItem = {
        ...item,
        evidences: item.evidences.filter((evidence) => validPageIds.has(evidence.documentPageId)),
      };
      const existing = perItemBatches.get(item.requestedItemId) ?? [];
      existing.push(sanitized);
      perItemBatches.set(item.requestedItemId, existing);
    }
  }

  const merged = params.items.map((item) => {
    const batchesForItem = perItemBatches.get(item.id) ?? [];
    if (batchesForItem.length === 0) {
      return {
        requestedItemId: item.id,
        status: 'NOT_ANSWERED' as RequestAnalysisItem['status'],
        explanation: 'Nenhuma página de resposta disponível para análise.',
        confidence: 0.5,
        evidences: [],
      };
    }
    return mergeItem(batchesForItem, REQUEST_STATUS_PRIORITY) as RequestAnalysisItem;
  });
  return { items: merged, usage };
}

export async function analyzeIndicationResponses(params: {
  provider: LLMProvider;
  items: AnalysisInputItem[];
  pages: PipelinePage[];
  maxPagesPerBatch: number;
  maxRetries: number;
}): Promise<{ items: IndicationAnalysisItem[]; usage: UsageEvent[] }> {
  const usage: UsageEvent[] = [];
  const batches = batchPages(params.pages, params.maxPagesPerBatch);
  const validPageIds = new Set(params.pages.map((page) => page.documentPageId));
  const perItemBatches = new Map<string, IndicationAnalysisItem[]>();

  for (const batch of batches) {
    const context = pageDelimitedContentWithIds(batch);
    const itemsList = params.items
      .map((item) => `- id="${item.id}": ${item.normalizedQuestion}`)
      .join('\n');
    const data = await callStructuredWithRetry({
      provider: params.provider,
      system: indicationAnalysisPromptV1.system,
      buildPrompt: (repair) =>
        `Subitens da indicação a avaliar neste lote (retorne uma entrada para cada um):\n${itemsList}\n\nPáginas deste lote:\n${context}${repairSuffix(repair)}`,
      schema: indicationAnalysisSchema,
      schemaDescription:
        'indicationAnalysisSchema (items[]: requestedItemId, status, explanation, confidence, evidences[])',
      maxRetries: params.maxRetries,
      operation: 'indication-analysis',
      usageSink: usage,
    });
    const validated = data.items.filter((item) =>
      params.items.some((requested) => requested.id === item.requestedItemId),
    );
    const filled = fillMissingItems(
      params.items.map((item) => item.id),
      validated,
      'NO_CLEAR_POSITION' as IndicationAnalysisItem['status'],
    );
    for (const item of filled) {
      const sanitized: IndicationAnalysisItem = {
        ...item,
        evidences: item.evidences.filter((evidence) => validPageIds.has(evidence.documentPageId)),
      };
      const existing = perItemBatches.get(item.requestedItemId) ?? [];
      existing.push(sanitized);
      perItemBatches.set(item.requestedItemId, existing);
    }
  }

  const merged = params.items.map((item) => {
    const batchesForItem = perItemBatches.get(item.id) ?? [];
    if (batchesForItem.length === 0) {
      return {
        requestedItemId: item.id,
        status: 'NO_CLEAR_POSITION' as IndicationAnalysisItem['status'],
        explanation: 'Nenhuma página de resposta disponível para análise.',
        confidence: 0.5,
        evidences: [],
      };
    }
    return mergeItem(batchesForItem, INDICATION_STATUS_PRIORITY) as IndicationAnalysisItem;
  });
  return { items: merged, usage };
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

export interface SummaryInputItem {
  id: string;
  question: string;
  status: string;
  explanation: string;
  evidenceIds: string[];
}

export async function generateExecutiveSummary(params: {
  provider: LLMProvider;
  items: SummaryInputItem[];
  maxRetries: number;
}): Promise<{ summary: ExecutiveSummary; usage: UsageEvent[] }> {
  const usage: UsageEvent[] = [];
  const structuredItems = params.items
    .map(
      (item) =>
        `- id="${item.id}" pergunta="${item.question}" status="${item.status}" evidenceIds=[${item.evidenceIds.join(', ')}]: ${item.explanation}`,
    )
    .join('\n');
  const summary = await callStructuredWithRetry({
    provider: params.provider,
    system: executiveSummaryPromptV1.system,
    buildPrompt: (repair) =>
      `Gere o resumo executivo com base somente nestes itens de análise já validados (não use PDF bruto):\n${structuredItems}${repairSuffix(repair)}`,
    schema: executiveSummarySchema,
    schemaDescription:
      'executiveSummarySchema (summary, mainFindings[], pendingItems[], importantNumbers[], importantDates[], mentionedEntities[])',
    maxRetries: params.maxRetries,
    operation: 'executive-summary',
    usageSink: usage,
  });
  return { summary, usage };
}
