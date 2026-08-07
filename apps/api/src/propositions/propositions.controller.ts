import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreatePropositionDto,
  DocumentLinkDto,
  ListPropositionsDto,
  UpdatePropositionDto,
} from './dto/proposition.dto';
import { PropositionsService } from './propositions.service';

@ApiTags('propositions')
@Controller('propositions')
export class PropositionsController {
  constructor(private readonly propositions: PropositionsService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list(@Query() query: ListPropositionsDto) {
    return this.propositions.list(query);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.propositions.get(id);
  }

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  create(@Body() dto: CreatePropositionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.propositions.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropositionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propositions.update(id, dto, user.id);
  }

  @Post(':id/documents')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  linkDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.propositions.linkDocument(id, dto, user.id);
  }
}
