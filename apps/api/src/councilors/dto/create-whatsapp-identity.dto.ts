import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWhatsappIdentityDto {
  @ApiProperty({ example: '+5511999999999' })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phoneNumber deve estar no formato E.164' })
  phoneNumber: string;

  @ApiProperty({ example: 'camara-principal' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  instance: string;
}
