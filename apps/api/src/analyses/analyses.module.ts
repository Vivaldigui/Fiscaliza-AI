import { Module } from '@nestjs/common';
import { AnalysesController, PropositionAnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';

@Module({
  controllers: [PropositionAnalysesController, AnalysesController],
  providers: [AnalysesService],
  exports: [AnalysesService],
})
export class AnalysesModule {}
