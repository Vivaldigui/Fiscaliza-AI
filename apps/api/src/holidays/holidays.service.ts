import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fiscaliza/database';
import { PrismaService } from '../database/prisma.service';
import { databaseDate } from '../deadlines/deadline-calculator';
import type { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.holiday.findMany({ orderBy: [{ date: 'asc' }, { scope: 'asc' }] });
  }

  async create(dto: CreateHolidayDto, actorId: string) {
    validateTimezone(dto.timezone);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const holiday = await transaction.holiday.create({
          data: { ...dto, date: databaseDate(dto.date) },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'HOLIDAY_CREATED',
            resourceType: 'Holiday',
            resourceId: holiday.id,
            newState: { date: dto.date, name: dto.name, scope: dto.scope },
          },
        });
        return holiday;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe feriado deste escopo nessa data.');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateHolidayDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.holiday.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Feriado não encontrado.');
      const updated = await transaction.holiday.update({ where: { id }, data: dto });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'HOLIDAY_UPDATED',
          resourceType: 'Holiday',
          resourceId: id,
          previousState: { name: current.name, active: current.active },
          newState: { name: updated.name, active: updated.active },
        },
      });
      return updated;
    });
  }
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
  } catch {
    throw new ConflictException('Timezone inválido.');
  }
}
