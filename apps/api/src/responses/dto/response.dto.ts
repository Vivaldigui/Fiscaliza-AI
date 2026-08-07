import { Type } from 'class-transformer';
import { DocumentLinkRole, ResponseStatus, ResponseType } from '@fiscaliza/database';
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

export class ResponseDocumentDto {
  @IsUUID()
  documentId: string;

  @IsEnum(DocumentLinkRole)
  role: DocumentLinkRole;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder = 0;
}

export class CreateResponseDto {
  @IsOptional()
  @IsUUID()
  propositionId?: string;

  @IsEnum(ResponseType)
  type: ResponseType;

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
  sender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ResponseDocumentDto)
  documents: ResponseDocumentDto[];
}

export class ListResponsesDto {
  @IsOptional()
  @IsEnum(ResponseType)
  type?: ResponseType;

  @IsOptional()
  @IsEnum(ResponseStatus)
  status?: ResponseStatus;

  @IsOptional()
  @IsUUID()
  propositionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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
