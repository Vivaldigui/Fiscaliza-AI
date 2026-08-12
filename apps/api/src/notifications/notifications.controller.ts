import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RoleCode } from '@fiscaliza/database';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

class ListNotificationsDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  @ApiOperation({ summary: 'Lista notificações com filtros e destinatário mascarado.' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'channel', required: false })
  list(@Query() query: ListNotificationsDto) {
    return this.notifications.list(query);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  @ApiOperation({ summary: 'Detalhe de uma notificação incluindo histórico de tentativas.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.get(id);
  }

  @Post(':id/retry')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  @ApiOperation({ summary: 'Reenfileira manualmente a entrega de uma notificação.' })
  retry(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request & { id?: string }) {
    return this.notifications.retry(id, request.id);
  }

  @Post(':id/cancel')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  @ApiOperation({ summary: 'Cancela a entrega de uma notificação ainda não enviada.' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request & { id?: string }) {
    return this.notifications.cancel(id, request.id);
  }
}
