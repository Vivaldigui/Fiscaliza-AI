import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AssociationsService } from './associations.service';
import { ConfirmAssociationDto, RejectCandidateDto } from './dto/association.dto';

@ApiTags('associations')
@Controller('associations')
export class AssociationsController {
  constructor(private readonly associations: AssociationsService) {}

  @Get('pending')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  pending() {
    return this.associations.pending();
  }

  @Post('responses/:responseId/evaluate')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  evaluate(@Param('responseId', ParseUUIDPipe) responseId: string) {
    return this.associations.evaluate(responseId);
  }

  @Post('responses/:responseId/confirm')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  confirm(
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body() dto: ConfirmAssociationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.associations.confirm(responseId, dto, user.id);
  }

  @Post('responses/:responseId/candidates/:candidateId/reject')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  reject(
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: RejectCandidateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.associations.reject(responseId, candidateId, dto, user.id);
  }
}
