import { EMBEDDING_VERSION, type EmbeddingProvider, type EmbeddingUsage } from '@fiscaliza/ai';
import { Prisma, type PrismaClient } from '@fiscaliza/database';
import type { WorkerConfig } from '../config';

export interface RetrievedPage {
  pageId: string;
  pageNumber: number;
  documentId: string;
  documentLabel: string;
  content: string;
}

interface RetrievedPageRow {
  pageId: string;
  pageNumber: number;
  documentId: string;
  documentLabel: string;
  content: string;
}

/**
 * Authorized semantic retrieval for the web conversation (Fase 5A / ADR-002).
 *
 * Authorization precedes ranking: the vector `ORDER BY ... LIMIT` runs over
 * ONLY the document allowlist of the referenced proposition (attachments +
 * official responses), constrained to the current processing attempt and to
 * the current embedding version. It never "retrieves globally and filters in
 * memory". With an empty allowlist there is nothing to search — callers must
 * short-circuit instead of invoking this.
 */
export class AuthorizedRetriever {
  private readonly version = EMBEDDING_VERSION;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingProvider,
    private readonly config: WorkerConfig,
  ) {}

  async embedQuery(question: string): Promise<{ vector: number[]; usage: EmbeddingUsage }> {
    const result = await this.embeddings.embed({ inputs: [question] });
    return { vector: result.embeddings[0]!, usage: result.usage };
  }

  /**
   * Documents a user may cite in a conversation about `propositionId`:
   * everything linked to the proposition (attachments/requirement) plus the
   * documents of the official responses associated with it.
   */
  async authorizedDocumentIds(propositionId: string): Promise<string[]> {
    const [links, responses] = await Promise.all([
      this.prisma.propositionDocument.findMany({
        where: { propositionId },
        select: { documentId: true },
      }),
      this.prisma.response.findMany({
        where: { propositionId },
        select: { id: true },
      }),
    ]);
    const responseIds = responses.map((response) => response.id);
    const responseLinks =
      responseIds.length > 0
        ? await this.prisma.responseDocument.findMany({
            where: { responseId: { in: responseIds } },
            select: { documentId: true },
          })
        : [];
    return [
      ...new Set([
        ...links.map((link) => link.documentId),
        ...responseLinks.map((link) => link.documentId),
      ]),
    ];
  }

  async retrieveTopPages(
    queryVector: number[],
    authorizedDocumentIds: string[],
  ): Promise<RetrievedPage[]> {
    if (authorizedDocumentIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<RetrievedPageRow[]>(Prisma.sql`
      SELECT "pageId", "pageNumber", "documentId", "documentLabel", "content"
      FROM (
        SELECT DISTINCT ON (c.page_id)
          c.page_id::text AS "pageId",
          c.page_number AS "pageNumber",
          d.id::text AS "documentId",
          d.original_name AS "documentLabel",
          c.content AS "content",
          c.embedding <=> ${queryVector}::vector AS "distance"
        FROM "document_chunks" c
        JOIN "document_pages" p ON p.id = c.page_id
        JOIN "document_processing_attempts" pa ON pa.id = c.processing_attempt_id
        JOIN "documents" d ON d.id = c.document_id
        WHERE c.embedding_hash IS NOT NULL
          AND c.embedding_version = ${this.version}
          AND d.id IN (${Prisma.join(
            authorizedDocumentIds.map((documentId) => Prisma.sql`${documentId}::uuid`),
          )})
          AND pa.attempt = d.processing_attempt
          AND pa.status = 'COMPLETED'
        ORDER BY c.page_id, c.embedding <=> ${queryVector}::vector
      ) ranked
      ORDER BY ranked."distance"
      LIMIT ${this.config.CONVERSATION_RAG_TOP_K}
    `);
    return rows.map((row) => ({
      pageId: row.pageId,
      pageNumber: row.pageNumber,
      documentId: row.documentId,
      documentLabel: row.documentLabel,
      content: row.content,
    }));
  }

  /**
   * Builds the delimited context block for the answer prompt. Truncates to the
   * configured budget of characters across all pages (never to a single page,
   * so the tail of a long answer is not silently dropped).
   */
  buildContext(pages: RetrievedPage[]): string {
    const budget = this.config.CONVERSATION_MAX_CONTEXT_CHARS;
    const blocks: string[] = [];
    let used = 0;
    for (const page of pages) {
      const remaining = budget - used;
      if (remaining <= 0) break;
      const excerpt = page.content.slice(0, remaining);
      blocks.push(`[PAGE id="${page.pageId}" number="${page.pageNumber}"]\n${excerpt}\n[/PAGE]`);
      used += excerpt.length;
    }
    return blocks.join('\n\n');
  }
}
