import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CouncilorsService } from './councilors.service';
import { CreateCouncilorDto } from './dto/create-councilor.dto';
import { CreateWhatsappIdentityDto } from './dto/create-whatsapp-identity.dto';
import { UpdateCouncilorDto } from './dto/update-councilor.dto';

@ApiTags('councilors')
@Controller('councilors')
export class CouncilorsController {
  constructor(private readonly councilors: CouncilorsService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list() {
    return this.councilors.list();
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.councilors.get(id);
  }

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  create(@Body() dto: CreateCouncilorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.councilors.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouncilorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.councilors.update(id, dto, user.id);
  }

  @Post(':id/whatsapp-identities')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  addWhatsappIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWhatsappIdentityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.councilors.addWhatsappIdentity(id, dto, user.id);
  }
}
