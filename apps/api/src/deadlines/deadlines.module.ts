import { Module } from '@nestjs/common';
import { DeadlinesController } from './deadlines.controller';
import { DeadlinesService } from './deadlines.service';

@Module({
  controllers: [DeadlinesController],
  providers: [DeadlinesService],
  exports: [DeadlinesService],
})
export class DeadlinesModule {}
