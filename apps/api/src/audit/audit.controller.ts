import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@fiscaliza/database';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../database/prisma.service';

class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

@ApiTags('audit')
@Controller('audit')
@Roles(RoleCode.ADMIN, RoleCode.AUDITOR)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.prisma.auditLog.findMany({
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        actorId: true,
        requestId: true,
        createdAt: true,
      },
    });
  }
}
