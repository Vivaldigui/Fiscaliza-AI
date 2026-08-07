import { Injectable } from '@nestjs/common';
import type { HealthComponent, HealthResponse } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage.service';
import { RedisService } from '../infrastructure/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: ObjectStorageService,
  ) {}

  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthResponse> {
    const [postgres, redis, minio] = await Promise.all([
      check(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      check(async () => {
        await this.redis.ping();
      }),
      check(async () => {
        await this.storage.assertBucketAvailable();
      }),
    ]);
    const services = { postgres, redis, minio };
    return {
      status: Object.values(services).every(({ status }) => status === 'up') ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
    };
  }
}

async function check(operation: () => Promise<void>): Promise<HealthComponent> {
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
