import { createHash, randomUUID } from 'node:crypto';
import {
  ConversationChannel,
  ConversationMessageStatus,
  DocumentAttemptStatus,
  DocumentProcessingTrigger,
  DocumentSecurityStatus,
  DocumentTextSource,
  OcrStatus,
  type MessageRole,
  PrismaClient,
  ProcessingStatus,
  PropositionType,
  TextExtractionStatus,
} from '@fiscaliza/database';
import {
  EMBEDDING_VERSION,
  FakeEmbeddingProvider,
  FakeLLMProvider,
  INSUFFICIENT_EVIDENCE_ANSWER,
  WEB_ANSWER_VERSION,
  WEB_STRUCTURED_VERSION,
} from '@fiscaliza/ai';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { ConversationAnswerPipeline } from './conversation-answer-pipeline';

const logger = new StructuredLogger('error');

const config = {
  CHAT_ENABLED: true,
  CONVERSATION_ANSWER_MAX_RETRIES: 1,
  CONVERSATION_RAG_TOP_K: 8,
  CONVERSATION_MAX_CONTEXT_CHARS: 60_000,
  EMBEDDINGS_PROVIDER: 'fake',
} as unknown as WorkerConfig;

describe('ConversationAnswerPipeline com PostgreSQL', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const embeddings = new FakeEmbeddingProvider({ model: 'fake-embedding-v1', dimension: 1536 });
  const documentIds: string[] = [];
  const propositionIds: string[] = [];
  const conversationIds: string[] = [];
  const userIds: string[] = [];
  let scenarioYear = 2298;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.conversationMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await prisma.proposition.deleteMany({ where: { id: { in: propositionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.$disconnect();
  });

  it('resolve perguntas estruturadas sem chamar o LLM', async () => {
    const { documentId } = await createIndexedDocument('Conteúdo irrelevante para o status.');
    const { messages } = await createConversationFixture(await createProposition([documentId]), [
      { role: 'USER', content: 'Qual o status da proposição?' },
    ]);
    const provider = new FakeLLMProvider();

    const pipeline = new ConversationAnswerPipeline(prisma, provider, embeddings, config, logger);
    await pipeline.process(messages[1]!.id, 'structured-1');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toContain('aguardando resposta');
    expect(answer.provider).toBeNull();
    expect(answer.answerVersion).toBe(WEB_STRUCTURED_VERSION);
    expect(answer.sources).toBeNull();
    expect(provider.structuredCallCount).toBe(0);
    const usages = await prisma.aIUsage.count({
      where: { conversationMessageId: answer.id },
    });
    expect(usages).toBe(0);
  });

  it('gera resposta RAG com fonte validada a partir do documento autorizado', async () => {
    const doc = await createIndexedDocument('A frota é composta por 12 veículos.');
    const proposition = await createProposition([doc.documentId]);
    const { messages } = await createConversationFixture(proposition, [
      { role: 'USER', content: 'Quantos veículos existem na frota?' },
    ]);
    const provider = new FakeLLMProvider();
    provider.queueStructured({
      answer: 'A frota tem 12 veículos.',
      sources: [
        {
          documentPageId: doc.pageId,
          pageNumber: 1,
          excerpt: 'A frota é composta por 12 veículos.',
        },
      ],
    });

    const pipeline = new ConversationAnswerPipeline(prisma, provider, embeddings, config, logger);
    await pipeline.process(messages[1]!.id, 'rag-1');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.answerVersion).toBe(WEB_ANSWER_VERSION);
    expect(answer.provider).toBe('fake');
    expect(answer.model).toBe(provider.model);
    expect(answer.sources).toMatchObject([
      { documentId: doc.documentId, documentPageId: doc.pageId, pageNumber: 1 },
    ]);
    const usages = await prisma.aIUsage.findMany({
      where: { conversationMessageId: answer.id },
    });
    expect(usages.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining(['web-answer', 'embedding']),
    );
  });

  it('rebaixa para evidência insuficiente quando o modelo cita fonte inventada', async () => {
    const doc = await createIndexedDocument('A frota é composta por 12 veículos.');
    const proposition = await createProposition([doc.documentId]);
    const { messages } = await createConversationFixture(proposition, [
      { role: 'USER', content: 'Quantos veículos existem na frota?' },
    ]);
    const provider = new FakeLLMProvider();
    provider.queueStructured({
      answer: 'A frota tem 12 veículos.',
      sources: [
        {
          documentPageId: '00000000-0000-4000-8000-00000000dead',
          pageNumber: 1,
          excerpt: 'Trecho que não existe na página.',
        },
      ],
    });

    const pipeline = new ConversationAnswerPipeline(prisma, provider, embeddings, config, logger);
    await pipeline.process(messages[1]!.id, 'rag-inject');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toBe(INSUFFICIENT_EVIDENCE_ANSWER);
    expect(answer.sources).toBeNull();
  });

  it('responde de forma determinística sem contexto de proposição (deny by default)', async () => {
    const { messages } = await createConversationFixture(null, [
      { role: 'USER', content: 'Qualquer pergunta sem proposição.' },
    ]);
    const provider = new FakeLLMProvider();

    const pipeline = new ConversationAnswerPipeline(prisma, provider, embeddings, config, logger);
    await pipeline.process(messages[1]!.id, 'no-context');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toBe(INSUFFICIENT_EVIDENCE_ANSWER);
    expect(provider.structuredCallCount).toBe(0);
  });

  it('falha fechada quando CHAT_ENABLED=false', async () => {
    const { messages } = await createConversationFixture(null, [
      { role: 'USER', content: 'Pergunta.' },
    ]);
    const provider = new FakeLLMProvider();
    const disabledConfig = { ...config, CHAT_ENABLED: false } as unknown as WorkerConfig;

    const pipeline = new ConversationAnswerPipeline(
      prisma,
      provider,
      embeddings,
      disabledConfig,
      logger,
    );
    await pipeline.process(messages[1]!.id, 'chat-disabled');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.FAILED);
    expect(answer.failureReason).toContain('CHAT_ENABLED');
    expect(provider.structuredCallCount).toBe(0);
  });

  it('ignora processamento duplicado de uma mensagem já concluída', async () => {
    const doc = await createIndexedDocument('A frota é composta por 12 veículos.');
    const proposition = await createProposition([doc.documentId]);
    const { messages } = await createConversationFixture(proposition, [
      { role: 'USER', content: 'Quantos veículos existem na frota?' },
    ]);
    const provider = new FakeLLMProvider();
    provider.queueStructured({
      answer: 'A frota tem 12 veículos.',
      sources: [
        {
          documentPageId: doc.pageId,
          pageNumber: 1,
          excerpt: 'A frota é composta por 12 veículos.',
        },
      ],
    });
    const pipeline = new ConversationAnswerPipeline(prisma, provider, embeddings, config, logger);

    await pipeline.process(messages[1]!.id, 'dedupe-1');
    expect(provider.structuredCallCount).toBe(1);
    await pipeline.process(messages[1]!.id, 'dedupe-2');
    expect(provider.structuredCallCount).toBe(1);
    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
  });

  async function createIndexedDocument(content: string) {
    const id = randomUUID();
    documentIds.push(id);
    const attemptId = randomUUID();
    const document = await prisma.document.create({
      data: {
        id,
        originalName: `documento-${id}.pdf`,
        mimeType: 'application/pdf',
        storageKey: `documents/${scenarioYear}/${id}/original.pdf`,
        sha256: createHash('sha256').update(`${suffix}-${id}`).digest('hex'),
        sizeBytes: 1000,
        pageCount: 1,
        processingAttempt: 1,
        processingStatus: ProcessingStatus.COMPLETED,
        securityStatus: DocumentSecurityStatus.CLEAN,
        textExtractionStatus: TextExtractionStatus.COMPLETED,
        ocrStatus: OcrStatus.NOT_REQUIRED,
        processingAttempts: {
          create: {
            id: attemptId,
            attempt: 1,
            trigger: DocumentProcessingTrigger.UPLOAD,
            status: DocumentAttemptStatus.COMPLETED,
          },
        },
        pages: {
          create: {
            processingAttemptId: attemptId,
            pageNumber: 1,
            extractedText: content,
            effectiveText: content,
            effectiveTextSource: DocumentTextSource.EXTRACTED,
            characterCount: content.length,
          },
        },
      },
      include: { pages: true },
    });
    const page = document.pages[0]!;
    const vector = (await embeddings.embed({ inputs: [content] })).embeddings[0]!;
    await prisma.documentChunk.create({
      data: {
        documentId: id,
        processingAttemptId: attemptId,
        pageId: page.id,
        pageNumber: 1,
        sequence: 1,
        content,
        contentHash: createHash('sha256').update(`${suffix}-${content}`).digest('hex'),
        embeddingHash: createHash('sha256').update(content).digest('hex'),
        embeddingProvider: 'fake',
        embeddingModel: embeddings.model,
        embeddingVersion: EMBEDDING_VERSION,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "document_chunks"
       SET "embedding" = ARRAY[${vector.map((value) => value.toFixed(6)).join(',')}]::vector
       WHERE "document_id" = '${id}'`,
    );
    return { documentId: document.id, attemptId, pageId: page.id };
  }

  async function createProposition(linkedDocumentIds: string[]) {
    scenarioYear += 1;
    const proposition = await prisma.proposition.create({
      data: {
        type: PropositionType.REQUEST,
        number: ((scenarioYear * 41 + randomUUID().length * 3) % 99_000) + 1,
        year: scenarioYear,
        protocolDate: new Date('2298-01-01T00:00:00Z'),
        subject: `Requerimento ${suffix} ${scenarioYear}`,
        status: 'AWAITING_RESPONSE',
        documents: {
          create: linkedDocumentIds.map((documentId) => ({ documentId, role: 'PRIMARY' })),
        },
      },
    });
    propositionIds.push(proposition.id);
    return proposition;
  }

  async function createConversationFixture(
    proposition: { id: string } | null,
    messages: Array<{ role: 'USER'; content: string }>,
  ) {
    const userId = randomUUID();
    userIds.push(userId);
    await prisma.user.create({
      data: {
        id: userId,
        email: `${randomUUID()}@test.local`,
        name: 'Vereador Sintético',
        passwordHash: 'x',
        status: 'ACTIVE',
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        channel: ConversationChannel.WEB,
        title: 'Conversa de teste',
        propositionId: proposition?.id ?? null,
      },
    });
    conversationIds.push(conversation.id);
    const created: Array<{ id: string; role: string; content: string }> = [];
    for (const message of messages) {
      const inputHash = createHash('sha256').update(message.content).digest('hex');
      created.push(
        await prisma.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: message.role,
            content: message.content,
            inputHash,
          },
        }),
      );
      created.push(
        await prisma.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'ASSISTANT',
            content: '',
            inputHash,
            status: 'PENDING',
          },
        }),
      );
    }
    return { conversation, messages: created as Array<{ id: string; role: MessageRole }> };
  }
});
