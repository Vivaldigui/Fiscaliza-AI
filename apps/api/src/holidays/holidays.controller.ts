import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';
import { HolidaysService } from './holidays.service';

@ApiTags('holidays')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT, RoleCode.AUDITOR)
  list() {
    return this.holidays.list();
  }

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.holidays.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SECRETARIAT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holidays.update(id, dto, user.id);
  }
}
