import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser, RoleCodeValue } from '@fiscaliza/shared';

const broadReadRoles: RoleCodeValue[] = ['ADMIN', 'SECRETARIAT', 'AUDITOR'];

@Injectable()
export class AuthorizationService {
  canReadProposition(user: AuthenticatedUser, authorCouncilorIds: string | string[]): boolean {
    if (user.roles.some((role) => broadReadRoles.includes(role))) return true;
    const authors = Array.isArray(authorCouncilorIds) ? authorCouncilorIds : [authorCouncilorIds];
    return (
      user.roles.includes('COUNCILOR') &&
      user.councilorId !== null &&
      authors.includes(user.councilorId)
    );
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
