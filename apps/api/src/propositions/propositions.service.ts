import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentKind,
  DocumentLinkRole,
  DocumentSecurityStatus,
  Prisma,
  ProcessingStatus,
  PropositionAuthorRole,
  PropositionStatus,
} from '@fiscaliza/database';
import { PrismaService } from '../database/prisma.service';
import { databaseDate } from '../deadlines/deadline-calculator';
import { DeadlinesService } from '../deadlines/deadlines.service';
import type {
  CreatePropositionDto,
  DocumentLinkDto,
  ListPropositionsDto,
  PropositionAuthorDto,
  UpdatePropositionDto,
} from './dto/proposition.dto';

const propositionInclude = {
  authors: {
    include: { councilor: { select: { id: true, displayName: true, party: true } } },
    orderBy: { role: 'desc' as const },
  },
  documents: {
    orderBy: [{ role: 'desc' as const }, { sortOrder: 'asc' as const }],
    include: {
      document: {
        select: {
          id: true,
          originalName: true,
          pageCount: true,
          processingStatus: true,
          securityStatus: true,
        },
      },
    },
  },
  responses: {
    orderBy: [{ protocolDate: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      documents: {
        include: { document: { select: { id: true, originalName: true, pageCount: true } } },
      },
    },
  },
  deadline: {
    include: {
      extensions: { orderBy: { grantedAt: 'asc' as const } },
      suspensions: { orderBy: { startedAt: 'asc' as const } },
      extensionRequests: { orderBy: { requestedAt: 'asc' as const } },
    },
  },
} satisfies Prisma.PropositionInclude;

@Injectable()
export class PropositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlines: DeadlinesService,
  ) {}

  async create(dto: CreatePropositionDto, actorId: string) {
    validateAuthors(dto.authors);
    validateDocumentLinks(dto.documents, true);
    await this.assertCouncilors(dto.authors);
    await this.assertDocuments(dto.documents);
    const deadline = await this.deadlines.prepare(dto.type, dto.protocolDate);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const proposition = await transaction.proposition.create({
          data: {
            type: dto.type,
            number: dto.number,
            year: dto.year,
            protocolNumber: dto.protocolNumber?.trim() || null,
            protocolDate: databaseDate(dto.protocolDate),
            recipient: dto.recipient?.trim() || null,
            subject: dto.subject.trim(),
            summary: dto.summary?.trim() || null,
            status: PropositionStatus.AWAITING_RESPONSE,
            authors: { create: dto.authors },
            documents: { create: dto.documents },
            deadline: { create: deadline },
          },
          include: propositionInclude,
        });
        await transaction.document.updateMany({
          where: { id: { in: dto.documents.map(({ documentId }) => documentId) } },
          data: { kind: DocumentKind.PROPOSITION },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'PROPOSITION_CREATED',
            resourceType: 'Proposition',
            resourceId: proposition.id,
            newState: {
              type: dto.type,
              number: dto.number,
              year: dto.year,
              authorCount: dto.authors.length,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'DEADLINE_CREATED',
            resourceType: 'Deadline',
            resourceId: proposition.deadline!.id,
            metadata: {
              propositionId: proposition.id,
              originalDueDate: proposition.deadline!.originalDueDate.toISOString().slice(0, 10),
              settingKey: `deadlines.policy.${proposition.type}`,
            },
          },
        });
        for (const document of dto.documents) {
          await transaction.auditLog.create({
            data: {
              actorId,
              action: 'PROPOSITION_DOCUMENT_LINKED',
              resourceType: 'Proposition',
              resourceId: proposition.id,
              metadata: { documentId: document.documentId, role: document.role },
            },
          });
        }
        await transaction.outboxEvent.createMany({
          data: [
            {
              eventType: 'PropositionCreated',
              aggregateType: 'Proposition',
              aggregateId: proposition.id,
              payload: {
                propositionId: proposition.id,
                type: proposition.type,
                number: proposition.number,
                year: proposition.year,
              },
            },
            {
              eventType: 'DeadlineCreated',
              aggregateType: 'Deadline',
              aggregateId: proposition.deadline!.id,
              payload: {
                deadlineId: proposition.deadline!.id,
                propositionId: proposition.id,
                dueDate: proposition.deadline!.currentDueDate.toISOString().slice(0, 10),
              },
            },
          ],
        });
        return proposition;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe proposição deste tipo, número e ano.');
      }
      throw error;
    }
  }

  async list(query: ListPropositionsDto) {
    const where: Prisma.PropositionWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.number ? { number: query.number } : {}),
      ...(query.year ? { year: query.year } : {}),
      ...(query.authorId ? { authors: { some: { councilorId: query.authorId } } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.deadlineStatus ? { deadline: { status: query.deadlineStatus } } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { protocolNumber: { contains: query.search, mode: 'insensitive' } },
              { recipient: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.proposition.findMany({
        where,
        orderBy: [{ year: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          authors: {
            include: { councilor: { select: { id: true, displayName: true, party: true } } },
          },
          deadline: true,
          _count: { select: { responses: true, documents: true } },
        },
      }),
      this.prisma.proposition.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const proposition = await this.prisma.proposition.findUnique({
      where: { id },
      include: propositionInclude,
    });
    if (!proposition) throw new NotFoundException('Proposição não encontrada.');
    const revisions = await this.prisma.responseAssociationRevision.findMany({
      where: {
        OR: [{ previousPropositionId: id }, { newPropositionId: id }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return { ...proposition, timeline: buildTimeline(proposition, revisions) };
  }

  async update(id: string, dto: UpdatePropositionDto, actorId: string) {
    if (dto.authors) {
      validateAuthors(dto.authors);
      await this.assertCouncilors(dto.authors);
    }
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.proposition.findUnique({
        where: { id },
        include: { authors: true },
      });
      if (!current) throw new NotFoundException('Proposição não encontrada.');
      if (dto.authors) {
        await transaction.propositionAuthor.deleteMany({ where: { propositionId: id } });
        await transaction.propositionAuthor.createMany({
          data: dto.authors.map((author) => ({ propositionId: id, ...author })),
        });
      }
      const updated = await transaction.proposition.update({
        where: { id },
        data: {
          protocolNumber: dto.protocolNumber,
          protocolDate: dto.protocolDate ? databaseDate(dto.protocolDate) : undefined,
          recipient: dto.recipient,
          subject: dto.subject,
          summary: dto.summary,
          status: dto.status,
        },
        include: propositionInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'PROPOSITION_UPDATED',
          resourceType: 'Proposition',
          resourceId: id,
          previousState: {
            status: current.status,
            protocolDate: current.protocolDate,
            authors: current.authors.map(({ councilorId, role }) => ({ councilorId, role })),
          },
          newState: {
            status: updated.status,
            protocolDate: updated.protocolDate,
            authors: updated.authors.map(({ councilorId, role }) => ({ councilorId, role })),
          },
        },
      });
      return updated;
    });
  }

  async linkDocument(id: string, link: DocumentLinkDto, actorId: string) {
    await this.assertDocuments([link]);
    return this.prisma.$transaction(async (transaction) => {
      const exists = await transaction.proposition.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Proposição não encontrada.');
      try {
        const result = await transaction.propositionDocument.create({
          data: { propositionId: id, ...link },
        });
        await transaction.document.update({
          where: { id: link.documentId },
          data: { kind: DocumentKind.PROPOSITION },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'PROPOSITION_DOCUMENT_LINKED',
            resourceType: 'Proposition',
            resourceId: id,
            metadata: { documentId: link.documentId, role: link.role },
          },
        });
        return result;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('Documento ou papel principal já vinculado.');
        throw error;
      }
    });
  }

  private async assertCouncilors(authors: PropositionAuthorDto[]) {
    const ids = [...new Set(authors.map(({ councilorId }) => councilorId))];
    const count = await this.prisma.councilor.count({ where: { id: { in: ids }, active: true } });
    if (count !== ids.length)
      throw new ConflictException('Um ou mais autores não existem ou estão inativos.');
  }

  private async assertDocuments(links: DocumentLinkDto[]) {
    const ids = [...new Set(links.map(({ documentId }) => documentId))];
    if (ids.length !== links.length)
      throw new ConflictException('Documento repetido na proposição.');
    const documents = await this.prisma.document.findMany({
      where: { id: { in: ids } },
      include: { propositionLinks: true, responseLinks: true },
    });
    if (documents.length !== ids.length)
      throw new NotFoundException('Um ou mais documentos não foram encontrados.');
    for (const document of documents) {
      if (
        document.securityStatus !== DocumentSecurityStatus.CLEAN ||
        document.processingStatus !== ProcessingStatus.COMPLETED
      ) {
        throw new ForbiddenException(
          'Somente documentos concluídos e aprovados pela segurança podem ser vinculados.',
        );
      }
      const requestedRole = links.find(({ documentId }) => documentId === document.id)?.role;
      if (
        requestedRole === DocumentLinkRole.PRIMARY &&
        (document.propositionLinks.some(({ role }) => role === DocumentLinkRole.PRIMARY) ||
          document.responseLinks.some(({ role }) => role === DocumentLinkRole.PRIMARY))
      ) {
        throw new ConflictException(
          'O documento principal já representa outro registro operacional.',
        );
      }
    }
  }
}

function validateAuthors(authors: PropositionAuthorDto[]) {
  const unique = new Set(authors.map(({ councilorId }) => councilorId));
  if (unique.size !== authors.length) throw new ConflictException('Autor repetido na proposição.');
  if (authors.filter(({ role }) => role === PropositionAuthorRole.PRIMARY).length !== 1) {
    throw new ConflictException('Informe exatamente um autor principal.');
  }
}

function validateDocumentLinks(documents: DocumentLinkDto[], requirePrimary: boolean) {
  const primary = documents.filter(({ role }) => role === DocumentLinkRole.PRIMARY).length;
  if ((requirePrimary && primary !== 1) || primary > 1)
    throw new ConflictException('Informe exatamente um documento principal.');
}

function buildTimeline(
  proposition: Prisma.PropositionGetPayload<{ include: typeof propositionInclude }>,
  revisions: Array<{
    id: string;
    responseId: string;
    createdAt: Date;
    previousPropositionId: string | null;
    newPropositionId: string | null;
  }>,
) {
  const events: Array<{
    id: string;
    occurredAt: Date;
    type: string;
    title: string;
    metadata?: object;
  }> = [];
  events.push({
    id: `proposition-${proposition.id}`,
    occurredAt: proposition.protocolDate ?? proposition.createdAt,
    type: 'PROPOSITION_PROTOCOLLED',
    title: 'Proposição protocolada',
  });
  if (proposition.deadline) {
    events.push({
      id: `deadline-${proposition.deadline.id}`,
      occurredAt: proposition.deadline.createdAt,
      type: 'DEADLINE_CREATED',
      title: 'Prazo iniciado',
      metadata: { dueDate: proposition.deadline.originalDueDate },
    });
    for (const request of proposition.deadline.extensionRequests)
      events.push({
        id: request.id,
        occurredAt: request.requestedAt,
        type: 'EXTENSION_REQUESTED',
        title: 'Pedido de prorrogação recebido',
      });
    for (const extension of proposition.deadline.extensions)
      events.push({
        id: extension.id,
        occurredAt: extension.grantedAt,
        type: 'DEADLINE_EXTENDED',
        title: 'Prorrogação registrada',
        metadata: { previousDueDate: extension.previousDueDate, newDueDate: extension.newDueDate },
      });
    for (const suspension of proposition.deadline.suspensions) {
      events.push({
        id: `${suspension.id}-start`,
        occurredAt: suspension.startedAt,
        type: 'DEADLINE_SUSPENDED',
        title: 'Prazo suspenso',
      });
      if (suspension.endedAt)
        events.push({
          id: `${suspension.id}-end`,
          occurredAt: suspension.endedAt,
          type: 'DEADLINE_RESUMED',
          title: 'Prazo retomado',
        });
    }
  }
  for (const response of proposition.responses)
    events.push({
      id: `response-${response.id}`,
      occurredAt: response.protocolDate ?? response.createdAt,
      type: 'RESPONSE_RECEIVED',
      title: 'Resposta recebida',
      metadata: { responseId: response.id, responseType: response.type },
    });
  for (const revision of revisions)
    events.push({
      id: revision.id,
      occurredAt: revision.createdAt,
      type: 'RESPONSE_ASSOCIATED',
      title:
        revision.previousPropositionId &&
        revision.previousPropositionId !== revision.newPropositionId
          ? 'Associação de resposta corrigida'
          : 'Resposta associada',
      metadata: { responseId: revision.responseId },
    });
  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
