import { IsInt, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ConfirmAssociationDto {
  @IsUUID()
  propositionId: string;

  @IsInt()
  @Min(0)
  expectedVersion: number;

  @IsString()
  @MaxLength(2000)
  reason: string;
}

export class RejectCandidateDto {
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @IsString()
  @MaxLength(2000)
  reason: string;
}
