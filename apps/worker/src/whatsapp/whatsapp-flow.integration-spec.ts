import { createHash, randomUUID } from 'node:crypto';
import {
  ConversationChannel,
  ConversationMessageStatus,
  DocumentAttemptStatus,
  DocumentProcessingTrigger,
  DocumentSecurityStatus,
  DocumentTextSource,
  OcrStatus,
  PrismaClient,
  ProcessingStatus,
  PropositionAuthorRole,
  PropositionType,
  RoleCode,
  TextExtractionStatus,
} from '@fiscaliza/database';
import { EMBEDDING_VERSION, FakeEmbeddingProvider, FakeLLMProvider } from '@fiscaliza/ai';
import type { WorkerConfig } from '../config';
import { StructuredLogger } from '../logger';
import { ConversationAnswerPipeline } from '../conversation/conversation-answer-pipeline';
import { WhatsappContextResolver } from './whatsapp-context-resolver';

const logger = new StructuredLogger('error');

const config = {
  CHAT_ENABLED: true,
  WHATSAPP_ENABLED: true,
  CONVERSATION_ANSWER_MAX_RETRIES: 1,
  CONVERSATION_RAG_TOP_K: 8,
  CONVERSATION_MAX_CONTEXT_CHARS: 60_000,
  EMBEDDINGS_PROVIDER: 'fake',
  WHATSAPP_SESSION_TTL_SECONDS: 3_600,
} as unknown as WorkerConfig;

class FakeRedis {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
}

describe('Fluxo WhatsApp com pipeline da Fase 5A (PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const embeddings = new FakeEmbeddingProvider({ model: 'fake-embedding-v1', dimension: 1536 });
  const redis = new FakeRedis();
  const documentIds: string[] = [];
  const propositionIds: string[] = [];
  const conversationIds: string[] = [];
  const userIds: string[] = [];
  const councilorIds: string[] = [];
  const identityIds: string[] = [];
  const notificationIds: string[] = [];
  const scenarioYear = 2398;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.role.upsert({
      where: { code: RoleCode.COUNCILOR },
      update: {},
      create: { code: RoleCode.COUNCILOR, name: 'Vereador' },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.conversationMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await prisma.proposition.deleteMany({ where: { id: { in: propositionIds } } });
    await prisma.whatsappIdentity.deleteMany({ where: { id: { in: identityIds } } });
    await prisma.councilor.deleteMany({ where: { id: { in: councilorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.$disconnect();
  });

  it('seleção "Requerimento 38/2026" ativa contexto e reutiliza o pipeline (cenários 12/13/16)', async () => {
    const doc = await createIndexedDocument('A frota municipal é composta por 12 veículos.');
    const { userId, councilorId, identityId } =
      await createAuthorizedUserWithIdentity('Vereador A');
    const proposition = await createProposition(
      doc.documentId,
      councilorId,
      'REQUERIMENTO-SELECAO',
      PropositionType.REQUEST,
      38,
      2026,
    );

    const conversation = await createWhatsappConversation(userId, identityId);
    const { assistantId } = await enqueueQuestion(conversation.id, 'requerimento 38/2026');
    const provider = new FakeLLMProvider();

    const pipeline = buildPipeline(provider);
    await pipeline.process(assistantId, 'select-38');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: assistantId },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toContain('Contexto ativado: Requerimento 38/2026');
    expect(provider.structuredCallCount).toBe(0);

    const updatedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updatedConversation.propositionId).toBe(proposition.id);

    const notification = await prisma.notification.findFirst({
      where: { identityId, type: 'WHATSAPP_CONVERSATION_REPLY' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    notificationIds.push(notification!.id);
  });

  it('pergunta estruturada após contexto usa o pipeline existente e gera resposta (cenário 16)', async () => {
    const doc = await createIndexedDocument('A frota municipal é composta por 12 veículos.');
    const { userId, councilorId, identityId } =
      await createAuthorizedUserWithIdentity('Vereador B');
    const proposition = await createProposition(
      doc.documentId,
      councilorId,
      'ESTRUTURADA',
      PropositionType.REQUEST,
      12,
      2026,
    );
    const conversation = await createWhatsappConversation(userId, identityId, proposition.id);
    const { assistantId } = await enqueueQuestion(conversation.id, 'Qual o status da proposição?');
    const provider = new FakeLLMProvider();

    const pipeline = buildPipeline(provider);
    await pipeline.process(assistantId, 'structured-whatsapp');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: assistantId },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toContain('aguardando resposta');
    expect(provider.structuredCallCount).toBe(0);

    const notification = await prisma.notification.findFirst({
      where: { identityId, type: 'WHATSAPP_CONVERSATION_REPLY' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    notificationIds.push(notification!.id);
  });

  it('coautor autorizado consegue selecionar a mesma proposição (cenário 12)', async () => {
    const doc = await createIndexedDocument('Iluminação pública do bairro central.');
    const primary = await createAuthorizedUserWithIdentity('Autor Principal');
    const proposition = await createProposition(
      doc.documentId,
      primary.councilorId,
      'COAUTORIA',
      PropositionType.INDICATION,
      7,
      2026,
    );
    const coauthor = await createAuthorizedUserWithIdentity('Coautor');
    await prisma.propositionAuthor.create({
      data: {
        propositionId: proposition.id,
        councilorId: coauthor.councilorId,
        role: PropositionAuthorRole.COAUTHOR,
      },
    });

    const conversation = await createWhatsappConversation(coauthor.userId, coauthor.identityId);
    const { assistantId } = await enqueueQuestion(conversation.id, 'indicação 7/2026');
    const provider = new FakeLLMProvider();

    const pipeline = buildPipeline(provider);
    await pipeline.process(assistantId, 'coauthor-select');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: assistantId },
    });
    expect(answer.status).toBe(ConversationMessageStatus.COMPLETED);
    expect(answer.content).toContain('Contexto ativado');
    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.propositionId).toBe(proposition.id);
  });

  it('identidade desativada após recebimento falha sem chamada ao LLM (cenário 11)', async () => {
    const doc = await createIndexedDocument('Conteúdo sensível que não pode vazar.');
    const { userId, councilorId, identityId } =
      await createAuthorizedUserWithIdentity('Vereador C');
    const proposition = await createProposition(
      doc.documentId,
      councilorId,
      'REVOGADO',
      PropositionType.REQUEST,
      21,
      2026,
    );
    const conversation = await createWhatsappConversation(userId, identityId, proposition.id);
    const { assistantId } = await enqueueQuestion(conversation.id, 'Quantos veículos?');
    await prisma.whatsappIdentity.update({ where: { id: identityId }, data: { active: false } });
    const provider = new FakeLLMProvider();
    provider.queueStructured({
      answer: 'não deve responder',
      sources: [],
    });

    const pipeline = buildPipeline(provider);
    await pipeline.process(assistantId, 'revoked-integration');

    const answer = await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: assistantId },
    });
    expect(answer.status).toBe(ConversationMessageStatus.FAILED);
    expect(provider.structuredCallCount).toBe(0);
    // Nenhuma notificação de resposta para mensagem falha.
    const notifications = await prisma.notification.count({
      where: { identityId, type: 'WHATSAPP_CONVERSATION_REPLY' },
    });
    expect(notifications).toBe(0);
  });

  function buildPipeline(provider: FakeLLMProvider) {
    const resolver = new WhatsappContextResolver(
      prisma as unknown as PrismaClient,
      redis as never,
      config,
      logger,
    );
    return new ConversationAnswerPipeline(
      prisma as unknown as PrismaClient,
      provider,
      embeddings,
      config,
      logger,
      resolver,
    );
  }

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

  async function createAuthorizedUserWithIdentity(displayName: string) {
    const userId = randomUUID();
    userIds.push(userId);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.COUNCILOR } });
    const user = await prisma.user.create({
      data: {
        id: userId,
        email: `${randomUUID()}@test.local`,
        name: displayName,
        passwordHash: 'x',
        status: 'ACTIVE',
        councilor: { create: { displayName } },
        roles: { create: { roleId: role.id } },
      },
      include: { councilor: true },
    });
    councilorIds.push(user.councilor!.id);
    const identity = await prisma.whatsappIdentity.create({
      data: {
        councilorId: user.councilor!.id,
        phoneNumber: `+55${(10000000000 + Math.floor(Math.random() * 9_000_000_000)).toString()}`,
        instance: 'camara-principal',
        verifiedAt: new Date(),
        active: true,
      },
    });
    identityIds.push(identity.id);
    return { userId, councilorId: user.councilor!.id, identityId: identity.id };
  }

  async function createProposition(
    documentId: string,
    authorCouncilorId: string,
    subject: string,
    type: PropositionType,
    number: number,
    year: number,
  ) {
    const proposition = await prisma.proposition.create({
      data: {
        type,
        number,
        year,
        protocolDate: new Date(`${year}-01-01T00:00:00Z`),
        subject: `${subject} ${suffix} ${year}`,
        status: 'AWAITING_RESPONSE',
        documents: { create: [{ documentId, role: 'PRIMARY' }] },
        authors: {
          create: [{ councilorId: authorCouncilorId, role: PropositionAuthorRole.PRIMARY }],
        },
      },
    });
    propositionIds.push(proposition.id);
    return proposition;
  }

  async function createWhatsappConversation(
    userId: string,
    identityId: string,
    propositionId?: string,
  ) {
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        channel: ConversationChannel.WHATSAPP,
        whatsappIdentityId: identityId,
        title: 'WhatsApp',
        propositionId: propositionId ?? null,
      },
    });
    conversationIds.push(conversation.id);
    return conversation;
  }

  async function enqueueQuestion(conversationId: string, content: string) {
    const inputHash = createHash('sha256').update(content).digest('hex');
    await prisma.conversationMessage.create({
      data: { conversationId, role: 'USER', content, inputHash },
    });
    const assistant = await prisma.conversationMessage.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: '',
        inputHash,
        status: 'PENDING',
      },
    });
    return { assistantId: assistant.id };
  }
});
