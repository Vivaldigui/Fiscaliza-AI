import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser, RoleCodeValue } from '@fiscaliza/shared';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';
import type { JwtPayload } from './auth.types';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractAccessToken(request);
    if (!token) throw new UnauthorizedException('Autenticação necessária.');

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (payload.type !== 'access') throw new Error('Tipo de token inválido');
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { roles: { include: { role: true } }, councilor: { select: { id: true } } },
      });
      if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.tokenVersion) {
        throw new Error('Usuário inativo ou token revogado');
      }
      request.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles.map(({ role }) => role.code as RoleCodeValue),
        councilorId: user.councilor?.id ?? null,
        tokenVersion: user.tokenVersion,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }
}

function extractAccessToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.fiscaliza_access;
}
