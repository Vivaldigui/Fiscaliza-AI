import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnalysesService } from './analyses.service';
import { ListAnalysesDto, ReviewAnalysisItemDto } from './dto/analysis.dto';

@ApiTags('propositions')
@Controller('propositions/:propositionId/analyses')
export class PropositionAnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  create(
    @Param('propositionId', ParseUUIDPipe) propositionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analyses.create(propositionId, user.id);
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list(
    @Param('propositionId', ParseUUIDPipe) propositionId: string,
    @Query() query: ListAnalysesDto,
  ) {
    return this.analyses.list(propositionId, query.limit);
  }
}

@ApiTags('analyses')
@Controller('analyses')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.analyses.get(id);
  }

  @Post(':id/review')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAnalysisItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analyses.review(id, dto, user.id);
  }

  @Post(':id/reanalyze')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  reanalyze(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyses.reanalyze(id, user.id);
  }
}
