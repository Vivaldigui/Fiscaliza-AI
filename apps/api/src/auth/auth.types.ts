import type { AuthenticatedUser } from '@fiscaliza/shared';

export interface JwtPayload {
  sub: string;
  tokenVersion: number;
  type: 'access';
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: Omit<AuthenticatedUser, 'tokenVersion'>;
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}
