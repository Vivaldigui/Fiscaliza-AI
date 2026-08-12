import {
  EMBEDDING_VERSION,
  INSUFFICIENT_EVIDENCE_ANSWER,
  StructuredOutputValidationError,
  WEB_ANSWER_VERSION,
  WEB_STRUCTURED_VERSION,
  webAnswerPromptV1,
  type EmbeddingProvider,
  type EmbeddingUsage,
  type LLMProvider,
  type LLMUsage,
} from '@fiscaliza/ai';
import { Prisma, type PrismaClient } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';
import type { StructuredLogger } from '../logger';
import { excerptExistsOnPage } from '../ai/evidence-validator';
import { AuthorizedRetriever, type RetrievedPage } from './retrieval';
import { resolveStructuredAnswer, type StructuredQueryData } from './structured-answers';

interface ValidatedSource {
  documentId: string;
  documentPageId: string;
  pageNumber: number;
  excerpt?: string;
}

interface AnswerUsage {
  answer: LLMUsage | null;
  embedding: EmbeddingUsage | null;
}

interface CompletionParams {
  messageId: string;
  conversationId: string;
  text: string;
  sources: ValidatedSource[];
  provider: string | null;
  model: string | null;
  answerVersion: string;
  embeddingVersion: string | null;
  usage: AnswerUsage;
}

/**
 * Generates the assistant answer for a web conversation (Fase 5A / ADR-002).
 *
 * Order of resolution:
 * 1. Deterministic PostgreSQL answer (status, protocol, numbering, authorship,
 *    type, deadlines, item count) — no LLM, no retrieval.
 * 2. Authorized RAG over the referenced proposition's documents. The vector
 *    ranking happens in SQL, constrained to the allowlist, to the current
 *    processing attempt and to the current embedding version; every source the
 *    model cites is re-validated against the actually-retrieved pages before
 *    being persisted. Claimed-but-unverifiable sources are dropped; if none
 *    survive, the answer degrades to the explicit "no evidence" message.
 * 3. Conversations without a proposition context have no authorized corpus —
 *    they receive the same explicit "no evidence" message (deny by default).
 */
export class ConversationAnswerPipeline {
  private readonly retriever: AuthorizedRetriever;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly llmProvider: LLMProvider,
    embeddingsProvider: EmbeddingProvider,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {
    this.retriever = new AuthorizedRetriever(prisma, embeddingsProvider, config);
  }

  async process(messageId: string, jobId: string): Promise<void> {
    if (!this.config.CHAT_ENABLED) {
      await this.fail(messageId, 'Chat web desabilitado (CHAT_ENABLED=false).');
      return;
    }
    const message = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { proposition: true } } },
    });
    if (!message || message.role !== 'ASSISTANT') {
      this.logger.warn('Mensagem de resposta não encontrada ou papel inválido.', {
        messageId,
        jobId,
        stage: 'conversation',
      });
      return;
    }
    if (message.status === 'COMPLETED') {
      this.logger.info('Resposta já concluída; job duplicado ignorado.', {
        messageId,
        jobId,
        stage: 'conversation',
      });
      return;
    }
    const userMessage = await this.prisma.conversationMessage.findFirst({
      where: {
        conversationId: message.conversationId,
        role: 'USER',
        inputHash: message.inputHash,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!userMessage) {
      await this.fail(messageId, 'Mensagem do usuário correspondente não encontrada.');
      return;
    }
    const question = userMessage.content;
    const proposition = message.conversation.proposition;

    try {
      if (proposition) {
        const structured = await this.loadStructuredQueryData(proposition.id);
        const resolved = resolveStructuredAnswer(question, structured);
        if (resolved) {
          await this.complete({
            messageId,
            conversationId: message.conversationId,
            text: resolved.text,
            sources: [],
            provider: null,
            model: null,
            answerVersion: WEB_STRUCTURED_VERSION,
            embeddingVersion: null,
            usage: { answer: null, embedding: null },
          });
          return;
        }
      }
      await this.answerWithRetrieval(messageId, message.conversationId, question, proposition);
    } catch (error) {
      await this.fail(messageId, this.describeError(error));
      throw error;
    }
  }

  private async loadStructuredQueryData(propositionId: string): Promise<StructuredQueryData> {
    const [proposition, deadline, authors, activeItemCount] = await Promise.all([
      this.prisma.proposition.findUniqueOrThrow({
        where: { id: propositionId },
        select: {
          type: true,
          number: true,
          year: true,
          protocolNumber: true,
          protocolDate: true,
          summary: true,
          status: true,
        },
      }),
      this.prisma.deadline.findUnique({
        where: { propositionId },
        select: { status: true, currentDueDate: true },
      }),
      this.prisma.propositionAuthor.findMany({
        where: { propositionId },
        select: { councilor: { select: { displayName: true } }, role: true },
      }),
      this.prisma.requestedItem.count({
        where: { propositionId, active: true },
      }),
    ]);
    return {
      type: proposition.type,
      number: proposition.number,
      year: proposition.year,
      protocolNumber: proposition.protocolNumber,
      protocolDate: proposition.protocolDate,
      summary: proposition.summary,
      status: proposition.status,
      authors: authors.map((author) => ({
        name: author.councilor.displayName,
        role: author.role,
      })),
      deadline: deadline
        ? { status: deadline.status, currentDueDate: deadline.currentDueDate }
        : null,
      activeItemCount,
    };
  }

  private async answerWithRetrieval(
    messageId: string,
    conversationId: string,
    question: string,
    proposition: { id: string } | null,
  ): Promise<void> {
    if (!proposition) {
      await this.complete({
        messageId,
        conversationId,
        text: INSUFFICIENT_EVIDENCE_ANSWER,
        sources: [],
        provider: null,
        model: null,
        answerVersion: WEB_ANSWER_VERSION,
        embeddingVersion: null,
        usage: { answer: null, embedding: null },
      });
      return;
    }

    const documentIds = await this.retriever.authorizedDocumentIds(proposition.id);
    if (documentIds.length === 0) {
      await this.complete({
        messageId,
        conversationId,
        text: INSUFFICIENT_EVIDENCE_ANSWER,
        sources: [],
        provider: null,
        model: null,
        answerVersion: WEB_ANSWER_VERSION,
        embeddingVersion: null,
        usage: { answer: null, embedding: null },
      });
      return;
    }

    const { vector: queryVector, usage: embeddingUsage } =
      await this.retriever.embedQuery(question);
    const pages = await this.retriever.retrieveTopPages(queryVector, documentIds);
    if (pages.length === 0) {
      await this.complete({
        messageId,
        conversationId,
        text: INSUFFICIENT_EVIDENCE_ANSWER,
        sources: [],
        provider: null,
        model: null,
        answerVersion: WEB_ANSWER_VERSION,
        embeddingVersion: EMBEDDING_VERSION,
        usage: { answer: null, embedding: embeddingUsage },
      });
      return;
    }

    const context = this.retriever.buildContext(pages);
    const prompt = `Pergunta do usuário:\n${question}\n\nContexto autorizado (somente estes documentos):\n${context}`;
    const result = await this.generateAnswerWithRetries(prompt);
    const { text, sources } = this.validateSources(result.rawSources, result.text, pages);

    await this.complete({
      messageId,
      conversationId,
      text,
      sources,
      provider: result.provider,
      model: result.model,
      answerVersion: WEB_ANSWER_VERSION,
      embeddingVersion: EMBEDDING_VERSION,
      usage: { answer: result.usage, embedding: embeddingUsage },
    });
  }

  private async generateAnswerWithRetries(prompt: string): Promise<{
    rawSources: Array<{ documentPageId: string; pageNumber: number; excerpt?: string }>;
    text: string;
    usage: LLMUsage;
    provider: string;
    model: string;
  }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.CONVERSATION_ANSWER_MAX_RETRIES; attempt += 1) {
      try {
        const result = await this.llmProvider.generateStructured({
          system: webAnswerPromptV1.system,
          prompt,
          schema: webAnswerPromptV1.schema,
          schemaDescription: webAnswerPromptV1.schemaDescription,
          temperature: 0,
        });
        return {
          rawSources: result.data.sources,
          text: result.data.answer,
          usage: result.usage,
          provider: result.provider,
          model: result.model,
        };
      } catch (error) {
        lastError = error;
        if (!(error instanceof StructuredOutputValidationError)) throw error;
        this.logger.warn('Saída do chat inválida; nova tentativa.', {
          attempt,
          stage: 'conversation',
        });
      }
    }
    throw lastError;
  }

  private validateSources(
    rawSources: Array<{ documentPageId: string; pageNumber: number; excerpt?: string }>,
    answer: string,
    pages: RetrievedPage[],
  ): { text: string; sources: ValidatedSource[] } {
    const pageByPageId = new Map(pages.map((page) => [page.pageId, page]));
    const valid: ValidatedSource[] = [];
    for (const source of rawSources) {
      const page = pageByPageId.get(source.documentPageId);
      if (!page) continue;
      if (page.pageNumber !== source.pageNumber) continue;
      if (source.excerpt && !excerptExistsOnPage(source.excerpt, page.content)) continue;
      valid.push({
        documentId: page.documentId,
        documentPageId: source.documentPageId,
        pageNumber: source.pageNumber,
        ...(source.excerpt ? { excerpt: source.excerpt } : {}),
      });
    }
    if (valid.length === 0 && rawSources.length > 0) {
      this.logger.warn(
        'Resposta do modelo citou fontes não verificáveis; rebaixada para evidência insuficiente.',
        { stage: 'conversation' },
      );
      return { text: INSUFFICIENT_EVIDENCE_ANSWER, sources: [] };
    }
    return { text: answer, sources: valid };
  }

  private async complete(params: CompletionParams): Promise<void> {
    const latencyMs =
      (params.usage.answer?.latencyMs ?? 0) + (params.usage.embedding?.latencyMs ?? 0);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.conversationMessage.update({
        where: { id: params.messageId },
        data: {
          status: 'COMPLETED',
          content: params.text,
          sources: params.sources.length
            ? (params.sources as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          provider: params.provider,
          model: params.model,
          answerVersion: params.answerVersion,
          embeddingVersion: params.embeddingVersion,
          inputTokens: params.usage.answer?.inputTokens ?? null,
          outputTokens: params.usage.answer?.outputTokens ?? null,
          latencyMs,
          failureReason: null,
        },
      });
      if (params.usage.answer) {
        await transaction.aIUsage.create({
          data: {
            conversationMessageId: params.messageId,
            provider: params.provider ?? 'db',
            model: params.model ?? params.answerVersion,
            operation: 'web-answer',
            promptVersion: params.answerVersion,
            analysisVersion: params.answerVersion,
            inputHash: await this.dbInputHash(params.messageId),
            inputTokens: params.usage.answer.inputTokens,
            outputTokens: params.usage.answer.outputTokens,
            latencyMs: params.usage.answer.latencyMs,
            cached: false,
          },
        });
      }
      if (params.usage.embedding) {
        await transaction.aIUsage.create({
          data: {
            conversationMessageId: params.messageId,
            provider: this.providerNameForUsage(),
            model: EMBEDDING_VERSION,
            operation: 'embedding',
            promptVersion: EMBEDDING_VERSION,
            analysisVersion: EMBEDDING_VERSION,
            inputHash: await this.dbInputHash(params.messageId),
            inputTokens: params.usage.embedding.inputTokens,
            outputTokens: null,
            latencyMs: params.usage.embedding.latencyMs,
            cached: false,
          },
        });
      }
      await transaction.conversation.update({
        where: { id: params.conversationId },
        data: { lastInteractionAt: new Date() },
      });
    });
    this.logger.info('Resposta de conversa concluída.', {
      messageId: params.messageId,
      answerVersion: params.answerVersion,
      sourceCount: params.sources.length,
      providedBy: params.provider ?? 'structured',
      stage: 'conversation',
    });
  }

  private async fail(messageId: string, reason: string): Promise<void> {
    await this.prisma.conversationMessage.updateMany({
      where: { id: messageId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 2_000) },
    });
    this.logger.error('Falha ao gerar resposta de conversa.', {
      messageId,
      stage: 'conversation',
      reason: reason.slice(0, 500),
    });
  }

  private providerNameForUsage(): string {
    return this.config.EMBEDDINGS_PROVIDER;
  }

  private dbInputHash(messageId: string): Promise<string> {
    return this.prisma.conversationMessage
      .findUniqueOrThrow({ where: { id: messageId }, select: { inputHash: true } })
      .then((row) => row.inputHash ?? `message:${messageId}`);
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'Falha desconhecida na resposta da conversa.';
  }
}
