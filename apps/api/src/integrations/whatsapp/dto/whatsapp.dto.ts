import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WhatsappInboundDto {
  @ApiProperty({ example: 'wamid.example' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  messageId!: string;

  @ApiProperty({ example: '+5535999999999' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phone!: string;

  @ApiProperty({ example: 'O que não responderam?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  text!: string;

  @ApiProperty({ example: '2026-08-12T10:30:00-03:00' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timestamp!: string;

  @ApiProperty({ example: 'camara-principal' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  instance!: string;

  @ApiPropertyOptional({ example: {} })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class WhatsappDeliveryCallbackDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  notificationId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  idempotencyKey!: string;

  @ApiProperty({ enum: ['SENT', 'DELIVERED', 'FAILED'] })
  @IsEnum(['SENT', 'DELIVERED', 'FAILED'] as const)
  status!: 'SENT' | 'DELIVERED' | 'FAILED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalMessageId?: string;

  @ApiPropertyOptional({ description: 'Erro sanitizado (sem tokens ou telefone completo).' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  error?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timestamp?: string;
}
