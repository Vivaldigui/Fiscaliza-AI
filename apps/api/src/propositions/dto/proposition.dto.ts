import { Type } from 'class-transformer';
import {
  DocumentLinkRole,
  DeadlineStatus,
  PropositionAuthorRole,
  PropositionStatus,
  PropositionType,
} from '@fiscaliza/database';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PropositionAuthorDto {
  @IsUUID()
  councilorId: string;

  @IsEnum(PropositionAuthorRole)
  role: PropositionAuthorRole;
}

export class DocumentLinkDto {
  @IsUUID()
  documentId: string;

  @IsEnum(DocumentLinkRole)
  role: DocumentLinkRole;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder = 0;
}

export class CreatePropositionDto {
  @IsEnum(PropositionType)
  type: PropositionType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  number: number;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  protocolNumber?: string;

  @IsDateString()
  protocolDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PropositionAuthorDto)
  authors: PropositionAuthorDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  recipient?: string;

  @IsString()
  @MaxLength(500)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DocumentLinkDto)
  documents: DocumentLinkDto[];
}

export class UpdatePropositionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  protocolNumber?: string;

  @IsOptional()
  @IsDateString()
  protocolDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  recipient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @IsEnum(PropositionStatus)
  status?: PropositionStatus;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PropositionAuthorDto)
  authors?: PropositionAuthorDto[];
}

export class ListPropositionsDto {
  @IsOptional()
  @IsEnum(PropositionType)
  type?: PropositionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  number?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsEnum(PropositionStatus)
  status?: PropositionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(DeadlineStatus)
  deadlineStatus?: DeadlineStatus;

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
