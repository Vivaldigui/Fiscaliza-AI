import { PartialType } from '@nestjs/swagger';
import { CreateCouncilorDto } from './create-councilor.dto';

export class UpdateCouncilorDto extends PartialType(CreateCouncilorDto) {}
