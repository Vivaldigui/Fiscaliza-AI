import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateResponseDto, ListResponsesDto, ResponseDocumentDto } from './dto/response.dto';
import { ResponsesService } from './responses.service';

@ApiTags('responses')
@Controller('responses')
export class ResponsesController {
  constructor(private readonly responses: ResponsesService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list(@Query() query: ListResponsesDto) {
    return this.responses.list(query);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.responses.get(id);
  }

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  create(@Body() dto: CreateResponseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.responses.create(dto, user.id);
  }

  @Post(':id/documents')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  linkDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResponseDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.responses.linkDocument(id, dto, user.id);
  }
}
