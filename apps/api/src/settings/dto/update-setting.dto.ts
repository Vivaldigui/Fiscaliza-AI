import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, Min } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty({ description: 'Novo valor tipado da configuração.' })
  @IsDefined()
  value: unknown;

  @ApiProperty({ description: 'Versão atualmente exibida, para evitar sobrescrita concorrente.' })
  @IsInt()
  @Min(1)
  version: number;
}
