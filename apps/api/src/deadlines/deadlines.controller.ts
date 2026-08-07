import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeadlinesService } from './deadlines.service';
import {
  CreateExtensionRequestDto,
  ExtendDeadlineDto,
  ListDeadlinesDto,
  ResumeDeadlineDto,
  SuspendDeadlineDto,
} from './dto/deadline.dto';

@ApiTags('deadlines')
@Controller('deadlines')
export class DeadlinesController {
  constructor(private readonly deadlines: DeadlinesService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list(@Query() query: ListDeadlinesDto) {
    return this.deadlines.list(query);
  }

  @Post(':id/extensions')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendDeadlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deadlines.extend(id, dto, user.id);
  }

  @Post(':id/extension-requests')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  extensionRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExtensionRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deadlines.createExtensionRequest(id, dto, user.id);
  }

  @Post(':id/suspensions')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDeadlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deadlines.suspend(id, dto, user.id);
  }

  @Post(':id/resume')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeDeadlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deadlines.resume(id, dto, user.id);
  }
}
