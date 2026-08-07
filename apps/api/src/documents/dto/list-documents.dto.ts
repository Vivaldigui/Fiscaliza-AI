import { Transform, Type } from 'class-transformer';
import { DocumentSecurityStatus, OcrStatus, ProcessingStatus } from '@fiscaliza/database';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListDocumentsDto {
  @IsOptional()
  @IsEnum(ProcessingStatus)
  status?: ProcessingStatus;

  @IsOptional()
  @IsEnum(DocumentSecurityStatus)
  securityStatus?: DocumentSecurityStatus;

  @IsOptional()
  @IsEnum(OcrStatus)
  ocrStatus?: OcrStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true')
  @IsBoolean()
  reviewRequired?: boolean;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
