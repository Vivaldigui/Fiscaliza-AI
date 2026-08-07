import { createServer, type Server, type ServerResponse } from 'node:http';
import type { PrismaClient } from '@fiscaliza/database';
import type Redis from 'ioredis';
import type { WorkerConfig } from './config';
import type { StructuredLogger } from './logger';
import type { WorkerObjectStorage } from './storage';

export class WorkerHealthServer {
  private server?: Server;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly storage: WorkerObjectStorage,
    private readonly config: WorkerConfig,
    private readonly logger: StructuredLogger,
  ) {}

  start(): void {
    this.server = createServer((request, response) => {
      if (request.url === '/health/live') {
        json(response, 200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
      }
      if (request.url === '/health/ready' || request.url === '/health') {
        void this.ready().then(({ status, body }) => json(response, status, body));
        return;
      }
      json(response, 404, { status: 'not_found' });
    });
    this.server.listen(this.config.WORKER_HEALTH_PORT, '0.0.0.0', () =>
      this.logger.info('Health server do worker iniciado.', {
        port: this.config.WORKER_HEALTH_PORT,
      }),
    );
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server?.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async ready(): Promise<{ status: number; body: object }> {
    const [postgres, redis, minio] = await Promise.all([
      check(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      check(async () => {
        await this.redis.ping();
      }),
      check(() => this.storage.assertBucketAvailable()),
    ]);
    const services = { postgres, redis, minio };
    const healthy = Object.values(services).every(({ status }) => status === 'up');
    return {
      status: healthy ? 200 : 503,
      body: {
        status: healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        services,
      },
    };
  }
}

async function check(operation: () => Promise<unknown>) {
  const startedAt = performance.now();
  try {
    await operation();
    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      message: 'Dependência indisponível',
    };
  }
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
