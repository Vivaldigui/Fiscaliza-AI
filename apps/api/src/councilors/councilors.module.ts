import { Module } from '@nestjs/common';
import { CouncilorsController } from './councilors.controller';
import { CouncilorsService } from './councilors.service';

@Module({ controllers: [CouncilorsController], providers: [CouncilorsService] })
export class CouncilorsModule {}
