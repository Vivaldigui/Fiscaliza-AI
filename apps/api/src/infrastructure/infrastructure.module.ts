import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [ObjectStorageService, RedisService],
  exports: [ObjectStorageService, RedisService],
})
export class InfrastructureModule {}
