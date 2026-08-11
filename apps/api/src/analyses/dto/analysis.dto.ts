import { AnalysisItemStatus } from '@fiscaliza/database';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReviewAnalysisItemDto {
  @IsUUID()
  analysisItemId: string;

  @IsEnum(AnalysisItemStatus)
  newStatus: AnalysisItemStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  newExplanation: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  justification: string;
}

export class ListAnalysesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
