import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@fiscaliza/shared';
import { RolesGuard } from './roles.guard';

const councilor: AuthenticatedUser = {
  id: 'user-1',
  email: 'vereador@example.invalid',
  name: 'Vereador Teste',
  roles: ['COUNCILOR'],
  councilorId: 'councilor-1',
  tokenVersion: 0,
};

describe('RolesGuard em rotas documentais', () => {
  const reflector = {
    getAllAndOverride: jest.fn(() => ['ADMIN', 'SECRETARIAT']),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  it('nega upload a vereador', () => {
    expect(() => guard.canActivate(context(councilor))).toThrow(ForbiddenException);
  });

  it('nega download a papel fora da lista da rota', () => {
    expect(() => guard.canActivate(context(councilor))).toThrow(ForbiddenException);
  });

  it.each(['ADMIN', 'SECRETARIAT'] as const)('permite operação documental a %s', (role) => {
    expect(guard.canActivate(context({ ...councilor, roles: [role] }))).toBe(true);
  });
});

function context(user: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
