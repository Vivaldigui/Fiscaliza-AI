import { Module } from '@nestjs/common';
import { AssociationsModule } from '../associations/associations.module';
import { ResponsesController } from './responses.controller';
import { ResponsesService } from './responses.service';

@Module({
  imports: [AssociationsModule],
  controllers: [ResponsesController],
  providers: [ResponsesService],
})
export class ResponsesModule {}
