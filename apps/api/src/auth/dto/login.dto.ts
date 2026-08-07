import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@camara.gov.br' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}
