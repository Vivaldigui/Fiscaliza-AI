import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsUUID()
  propositionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  content: string;
}
