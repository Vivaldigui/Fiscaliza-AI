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
  ResponseStatus,
} from '@fiscaliza/database';
import { AssociationsService } from '../associations/associations.service';
import { PrismaService } from '../database/prisma.service';
import { databaseDate } from '../deadlines/deadline-calculator';
import type { CreateResponseDto, ListResponsesDto, ResponseDocumentDto } from './dto/response.dto';

@Injectable()
export class ResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly associations: AssociationsService,
  ) {}

  async create(dto: CreateResponseDto, actorId: string) {
    validateLinks(dto.documents);
    await this.assertDocuments(dto.documents);
    if (dto.propositionId) await this.assertProposition(dto.propositionId);
    const response = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.response.create({
        data: {
          type: dto.type,
          protocolNumber: dto.protocolNumber?.trim() || null,
          protocolDate: dto.protocolDate ? databaseDate(dto.protocolDate) : null,
          sender: dto.sender?.trim() || null,
          subject: dto.subject?.trim() || null,
          status: ResponseStatus.INGESTED,
          documents: { create: dto.documents },
        },
      });
      await transaction.document.updateMany({
        where: { id: { in: dto.documents.map(({ documentId }) => documentId) } },
        data: { kind: DocumentKind.RESPONSE },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'RESPONSE_CREATED',
          resourceType: 'Response',
          resourceId: created.id,
          newState: {
            type: created.type,
            protocolNumber: created.protocolNumber,
            documentCount: dto.documents.length,
          },
        },
      });
      for (const document of dto.documents) {
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'RESPONSE_DOCUMENT_LINKED',
            resourceType: 'Response',
            resourceId: created.id,
            metadata: { documentId: document.documentId, role: document.role },
          },
        });
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: 'ResponseCreated',
          aggregateType: 'Response',
          aggregateId: created.id,
          payload: { responseId: created.id, type: created.type },
        },
      });
      return created;
    });
    if (dto.propositionId) {
      await this.associations.confirm(
        response.id,
        {
          propositionId: dto.propositionId,
          expectedVersion: 0,
          reason: 'Associação informada no cadastro da resposta.',
        },
        actorId,
      );
    } else {
      await this.associations.evaluate(response.id);
    }
    return this.get(response.id);
  }

  async list(query: ListResponsesDto) {
    const where: Prisma.ResponseWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.propositionId ? { propositionId: query.propositionId } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { protocolNumber: { contains: query.search, mode: 'insensitive' } },
              { sender: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.response.findMany({
        where,
        orderBy: [{ protocolDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          proposition: {
            select: { id: true, type: true, number: true, year: true, subject: true },
          },
          documents: { include: { document: { select: { id: true, originalName: true } } } },
          _count: { select: { associationCandidates: true } },
        },
      }),
      this.prisma.response.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const response = await this.prisma.response.findUnique({
      where: { id },
      include: {
        proposition: { include: { authors: { include: { councilor: true } } } },
        documents: {
          orderBy: [{ role: 'desc' }, { sortOrder: 'asc' }],
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
        associationEvaluations: {
          orderBy: { createdAt: 'desc' },
          include: {
            candidates: {
              orderBy: { rank: 'asc' },
              include: {
                proposition: {
                  select: { id: true, type: true, number: true, year: true, subject: true },
                },
              },
            },
          },
        },
        associationRevisions: {
          orderBy: { createdAt: 'desc' },
          include: { changedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!response) throw new NotFoundException('Resposta não encontrada.');
    return response;
  }

  async linkDocument(id: string, link: ResponseDocumentDto, actorId: string) {
    await this.assertDocuments([link]);
    return this.prisma.$transaction(async (transaction) => {
      const exists = await transaction.response.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException('Resposta não encontrada.');
      try {
        const created = await transaction.responseDocument.create({
          data: { responseId: id, ...link },
        });
        await transaction.document.update({
          where: { id: link.documentId },
          data: { kind: DocumentKind.RESPONSE },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'RESPONSE_DOCUMENT_LINKED',
            resourceType: 'Response',
            resourceId: id,
            metadata: { documentId: link.documentId, role: link.role },
          },
        });
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('Documento ou papel principal já vinculado.');
        throw error;
      }
    });
  }

  private async assertProposition(id: string) {
    if (!(await this.prisma.proposition.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('Proposição não encontrada.');
  }

  private async assertDocuments(links: ResponseDocumentDto[]) {
    const ids = [...new Set(links.map(({ documentId }) => documentId))];
    if (ids.length !== links.length) throw new ConflictException('Documento repetido na resposta.');
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
      )
        throw new ForbiddenException(
          'Somente documentos concluídos e aprovados pela segurança podem ser vinculados.',
        );
      const requestedRole = links.find(({ documentId }) => documentId === document.id)?.role;
      if (
        requestedRole === DocumentLinkRole.PRIMARY &&
        (document.propositionLinks.some(({ role }) => role === DocumentLinkRole.PRIMARY) ||
          document.responseLinks.some(({ role }) => role === DocumentLinkRole.PRIMARY))
      )
        throw new ConflictException(
          'O documento principal já representa outro registro operacional.',
        );
    }
  }
}

function validateLinks(documents: ResponseDocumentDto[]) {
  if (documents.filter(({ role }) => role === DocumentLinkRole.PRIMARY).length !== 1)
    throw new ConflictException('Informe exatamente um documento principal para a resposta.');
}
