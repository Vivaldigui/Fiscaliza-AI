import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser, RoleCodeValue } from '@fiscaliza/shared';

const broadReadRoles: RoleCodeValue[] = ['ADMIN', 'SECRETARIAT', 'AUDITOR'];

@Injectable()
export class AuthorizationService {
  canReadProposition(user: AuthenticatedUser, authorCouncilorId: string): boolean {
    if (user.roles.some((role) => broadReadRoles.includes(role))) return true;
    return user.roles.includes('COUNCILOR') && user.councilorId === authorCouncilorId;
  }

  canManageDocuments(user: AuthenticatedUser): boolean {
    return user.roles.includes('ADMIN') || user.roles.includes('SECRETARIAT');
  }

  canReviewAnalysis(user: AuthenticatedUser): boolean {
    return user.roles.includes('ADMIN') || user.roles.includes('SECRETARIAT');
  }

  canConfigureSystem(user: AuthenticatedUser): boolean {
    return user.roles.includes('ADMIN');
  }
}
