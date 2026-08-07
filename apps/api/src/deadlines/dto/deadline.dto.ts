import { Type } from 'class-transformer';
import { DeadlineStatus } from '@fiscaliza/database';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListDeadlinesDto {
  @IsOptional()
  @IsUUID()
  propositionId?: string;

  @IsOptional()
  @IsEnum(DeadlineStatus)
  status?: DeadlineStatus;

  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class ExtendDeadlineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  extensionDays?: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsInt()
  @Min(0)
  version: number;
}

export class SuspendDeadlineDto {
  @IsString()
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsInt()
  @Min(0)
  version: number;
}

export class ResumeDeadlineDto {
  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsInt()
  @Min(0)
  version: number;
}

export class CreateExtensionRequestDto {
  @IsDateString()
  requestedAt: string;

  @IsOptional()
  @IsDateString()
  requestedDueDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  requestedDays?: number;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
