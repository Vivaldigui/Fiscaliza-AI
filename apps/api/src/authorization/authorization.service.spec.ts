import type { AuthenticatedUser } from '@fiscaliza/shared';
import { AuthorizationService } from './authorization.service';

const baseUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'vereador@example.invalid',
  name: 'Vereador Teste',
  roles: ['COUNCILOR'],
  councilorId: 'councilor-1',
  tokenVersion: 0,
};

describe('AuthorizationService', () => {
  const service = new AuthorizationService();

  it('permite que vereador leia proposição própria', () => {
    expect(service.canReadProposition(baseUser, 'councilor-1')).toBe(true);
  });

  it('nega proposição de outro vereador', () => {
    expect(service.canReadProposition(baseUser, 'councilor-2')).toBe(false);
  });

  it.each(['ADMIN', 'SECRETARIAT', 'AUDITOR'] as const)('permite leitura ampla para %s', (role) => {
    expect(service.canReadProposition({ ...baseUser, roles: [role] }, 'councilor-2')).toBe(true);
  });

  it('reserva configurações ao administrador', () => {
    expect(service.canConfigureSystem(baseUser)).toBe(false);
    expect(service.canConfigureSystem({ ...baseUser, roles: ['ADMIN'] })).toBe(true);
  });

  it('restringe ingestão documental a administrador e secretaria', () => {
    expect(service.canManageDocuments(baseUser)).toBe(false);
    expect(service.canManageDocuments({ ...baseUser, roles: ['AUDITOR'] })).toBe(false);
    expect(service.canManageDocuments({ ...baseUser, roles: ['ADMIN'] })).toBe(true);
    expect(service.canManageDocuments({ ...baseUser, roles: ['SECRETARIAT'] })).toBe(true);
  });
});
