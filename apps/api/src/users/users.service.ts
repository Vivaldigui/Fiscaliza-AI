import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@fiscaliza/database';
import { hash } from 'argon2';
import { PrismaService } from '../database/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        councilor: { select: { id: true, displayName: true } },
      },
    });
  }

  async create(dto: CreateUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const roleCodes = [...new Set(dto.roles)];
    const roles = await this.prisma.role.findMany({ where: { code: { in: roleCodes } } });
    if (roles.length !== roleCodes.length)
      throw new ConflictException('Um ou mais papéis são inválidos.');

    const passwordHash = await hash(dto.password, { type: 2 });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email,
            name: dto.name.trim(),
            passwordHash,
            status: UserStatus.ACTIVE,
            roles: { create: roles.map((role) => ({ roleId: role.id })) },
          },
          select: { id: true, email: true, name: true, status: true, createdAt: true },
        });
        if (dto.councilorId) {
          await transaction.councilor.update({
            where: { id: dto.councilorId },
            data: { userId: user.id },
          });
        }
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'USER_CREATED',
            resourceType: 'User',
            resourceId: user.id,
            newState: { email: user.email, roles: roleCodes },
          },
        });
        return user;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('E-mail ou vereador já está vinculado a outro usuário.');
      }
      throw error;
    }
  }
}
