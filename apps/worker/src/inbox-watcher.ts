import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { PrismaClient } from '@fiscaliza/database';
import {
  DocumentIngestionService,
  DocumentProcessingError,
  PrismaDocumentIngestionRepository,
  sanitizeOriginalName,
} from '@fiscaliza/document-processing';
import type { WorkerConfig } from './config';
import type { StructuredLogger } from './logger';
import type { WorkerObjectStorage } from './storage';

export class InboxWatcher {
  private watcher?: FSWatcher;
  private readonly active = new Set<string>();
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaClient,
    storage: WorkerObjectStorage,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
    ingestion?: DocumentIngestionService,
  ) {
    this.root = path.resolve(config.DOCUMENT_INBOX_PATH);
    this.ingestion =
      ingestion ??
      new DocumentIngestionService(new PrismaDocumentIngestionRepository(prisma), storage, {
        maxSizeBytes: config.DOCUMENT_MAX_SIZE_MB * 1024 * 1024,
      });
  }

  private readonly ingestion: DocumentIngestionService;

  async start(): Promise<void> {
    await Promise.all([
      mkdir(this.root, { recursive: true }),
      mkdir(path.join(this.root, 'processed'), { recursive: true }),
      mkdir(path.join(this.root, 'processed', 'duplicates'), { recursive: true }),
      mkdir(path.join(this.root, 'rejected'), { recursive: true }),
    ]);
    this.watcher = chokidar.watch(this.root, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
      usePolling: true,
      interval: this.config.DOCUMENT_WATCHER_POLL_INTERVAL_MS,
      binaryInterval: this.config.DOCUMENT_WATCHER_POLL_INTERVAL_MS,
    });
    this.watcher.on('add', (filePath) => void this.handle(filePath));
    this.watcher.on('error', (error) =>
      this.logger.error('Watcher da inbox falhou.', {
        stage: 'inbox',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    this.logger.info('Watcher da inbox iniciado.', { stage: 'inbox', inboxPath: this.root });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }

  private async handle(candidate: string): Promise<void> {
    const resolved = path.resolve(candidate);
    if (
      path.dirname(resolved) !== this.root ||
      path.extname(resolved).toLowerCase() !== '.pdf' ||
      this.active.has(resolved)
    ) {
      return;
    }
    this.active.add(resolved);
    try {
      await waitForStableFile(
        resolved,
        this.config.DOCUMENT_WATCHER_STABILITY_MS,
        this.config.DOCUMENT_WATCHER_POLL_INTERVAL_MS,
        this.config.DOCUMENT_PROCESSING_TIMEOUT,
      );
      const result = await this.ingestion.ingest({
        filePath: resolved,
        originalName: path.basename(resolved),
        declaredMimeType: 'application/pdf',
        source: 'INBOX',
        requestId: `inbox-${randomUUID()}`,
      });
      await this.move(
        resolved,
        result.duplicate ? path.join('processed', 'duplicates') : 'processed',
      );
      this.logger.info(
        result.duplicate ? 'Duplicata ignorada pela inbox.' : 'PDF ingerido pela inbox.',
        {
          stage: 'inbox',
          documentId: result.documentId,
          duplicate: result.duplicate,
        },
      );
    } catch (error) {
      await this.move(resolved, 'rejected').catch(() => undefined);
      const code = error instanceof DocumentProcessingError ? error.code : 'DOCUMENT_CORRUPTED';
      await this.prisma.auditLog.create({
        data: {
          action: 'DOCUMENT_UPLOAD_REJECTED',
          resourceType: 'Document',
          metadata: { code, originalName: sanitizeOriginalName(path.basename(resolved)) },
        },
      });
      this.logger.warn('Arquivo rejeitado pela inbox.', {
        stage: 'inbox',
        code,
        error: error instanceof Error ? error.message : 'falha desconhecida',
      });
    } finally {
      this.active.delete(resolved);
    }
  }

  private async move(source: string, relativeDirectory: string): Promise<void> {
    const destinationDirectory = path.resolve(this.root, relativeDirectory);
    if (!destinationDirectory.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Destino da inbox saiu do volume permitido.');
    }
    await mkdir(destinationDirectory, { recursive: true });
    const name = `${randomUUID()}-${sanitizeOriginalName(path.basename(source))}`;
    await rename(source, path.join(destinationDirectory, name));
  }
}

async function waitForStableFile(
  filePath: string,
  stabilityMs: number,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let last = await stat(filePath);
  let stableSince = Date.now();
  while (Date.now() - stableSince < stabilityMs) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new DocumentProcessingError(
        'PROCESSING_TIMEOUT',
        'O arquivo não estabilizou no prazo configurado.',
        true,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(50, pollIntervalMs)));
    const current = await stat(filePath);
    if (current.size !== last.size || current.mtimeMs !== last.mtimeMs) {
      last = current;
      stableSince = Date.now();
    }
  }
}
