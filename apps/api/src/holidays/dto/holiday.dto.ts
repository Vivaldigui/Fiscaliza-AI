import { HolidayScope } from '@fiscaliza/database';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  date: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsEnum(HolidayScope)
  scope: HolidayScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone = 'America/Sao_Paulo';
}

export class UpdateHolidayDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
