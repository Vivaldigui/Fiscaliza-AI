import { Module } from '@nestjs/common';
import { DeadlinesModule } from '../deadlines/deadlines.module';
import { PropositionsController } from './propositions.controller';
import { PropositionsService } from './propositions.service';

@Module({
  imports: [DeadlinesModule],
  controllers: [PropositionsController],
  providers: [PropositionsService],
  exports: [PropositionsService],
})
export class PropositionsModule {}
