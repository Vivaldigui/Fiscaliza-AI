import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserStatus } from '@fiscaliza/database';
import type { AuthenticatedUser, RoleCodeValue } from '@fiscaliza/shared';
import { verify } from 'argon2';
import { PrismaService } from '../database/prisma.service';
import type { AuthResult, JwtPayload, RequestMetadata } from './auth.types';

const authUserInclude = {
  roles: { include: { role: true } },
  councilor: { select: { id: true } },
} satisfies Prisma.UserInclude;

type UserWithAuthorization = Prisma.UserGetPayload<{ include: typeof authUserInclude }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    emailInput: string,
    password: string,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, include: authUserInclude });
    const valid = user ? await verify(user.passwordHash, password).catch(() => false) : false;

    if (!user || !valid || user.status !== UserStatus.ACTIVE) {
      await this.writeLoginAudit(null, false, metadata);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const result = await this.issueSession(user, metadata);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'AUTH_LOGIN_SUCCEEDED',
          resourceType: 'User',
          resourceId: user.id,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          requestId: metadata.requestId,
        },
      }),
    ]);
    return result;
  }

  async refresh(refreshToken: string | undefined, metadata: RequestMetadata): Promise<AuthResult> {
    if (!refreshToken) throw new UnauthorizedException('Sessão expirada.');
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: authUserInclude } },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Sessão expirada.');
    }

    const newRefreshToken = randomBytes(48).toString('base64url');
    const newSessionId = randomUUID();
    const expiresAt = this.refreshExpiry();

    const user = session.user;
    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: newSessionId, lastUsedAt: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Sessão já utilizada.');
      await transaction.refreshSession.create({
        data: {
          id: newSessionId,
          userId: user.id,
          tokenHash: hashToken(newRefreshToken),
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: 'AUTH_TOKEN_REFRESHED',
          resourceType: 'RefreshSession',
          resourceId: newSessionId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          requestId: metadata.requestId,
        },
      });
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: newRefreshToken,
      user: publicUser(user),
    };
  }

  async logout(refreshToken: string | undefined, userId: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshSession.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (userId) {
      await this.prisma.auditLog.create({
        data: { actorId: userId, action: 'AUTH_LOGOUT', resourceType: 'User', resourceId: userId },
      });
    }
  }

  private async issueSession(
    user: UserWithAuthorization,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      user: publicUser(user),
    };
  }

  private signAccessToken(
    user: Pick<UserWithAuthorization, 'id' | 'tokenVersion'>,
  ): Promise<string> {
    const payload: JwtPayload = { sub: user.id, tokenVersion: user.tokenVersion, type: 'access' };
    return this.jwt.signAsync(payload);
  }

  private refreshExpiry(): Date {
    const days = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async writeLoginAudit(
    actorId: string | null,
    succeeded: boolean,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: succeeded ? 'AUTH_LOGIN_SUCCEEDED' : 'AUTH_LOGIN_FAILED',
        resourceType: 'User',
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        requestId: metadata.requestId,
      },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function publicUser(user: UserWithAuthorization): Omit<AuthenticatedUser, 'tokenVersion'> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map(({ role }) => role.code as RoleCodeValue),
    councilorId: user.councilor?.id ?? null,
  };
}
