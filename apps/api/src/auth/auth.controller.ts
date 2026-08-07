import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import type { RequestMetadata } from './auth.types';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sessão autenticada.' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; user: object }> {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      requestMetadata(request, response),
    );
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; user: object }> {
    const result = await this.auth.refresh(
      readCookie(request, 'fiscaliza_refresh'),
      requestMetadata(request, response),
    );
    this.setSessionCookies(response, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  async logout(
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(request, 'fiscaliza_refresh'), user.id);
    response.clearCookie('fiscaliza_access', this.cookieOptions(false));
    response.clearCookie('fiscaliza_refresh', this.cookieOptions(false));
  }

  @Get('me')
  @ApiCookieAuth()
  me(@CurrentUser() user: AuthenticatedUser): Omit<AuthenticatedUser, 'tokenVersion'> {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      councilorId: user.councilorId,
    };
  }

  private setSessionCookies(response: Response, accessToken: string, refreshToken: string): void {
    const accessTtl = this.config.getOrThrow<number>('JWT_ACCESS_TTL_MINUTES') * 60 * 1000;
    const refreshTtl = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS') * 86_400_000;
    response.cookie('fiscaliza_access', accessToken, {
      ...this.cookieOptions(false),
      maxAge: accessTtl,
    });
    response.cookie('fiscaliza_refresh', refreshToken, {
      ...this.cookieOptions(true),
      maxAge: refreshTtl,
    });
  }

  private cookieOptions(refresh: boolean): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN')?.trim();
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: 'lax',
      path: refresh ? '/api/v1/auth' : '/',
      ...(domain ? { domain } : {}),
    };
  }
}

function readCookie(request: Request, name: string): string | undefined {
  return (request.cookies as Record<string, string> | undefined)?.[name];
}

function requestMetadata(request: Request, response: Response): RequestMetadata {
  const requestId = response.getHeader('x-request-id')?.toString();
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
