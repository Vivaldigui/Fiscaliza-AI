import { SetMetadata } from '@nestjs/common';
import type { RoleCode } from '@fiscaliza/database';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleCode[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
