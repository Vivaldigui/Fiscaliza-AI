export const ROLE_CODES = ['ADMIN', 'SECRETARIAT', 'COUNCILOR', 'AUDITOR'] as const;
export type RoleCodeValue = (typeof ROLE_CODES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: RoleCodeValue[];
  councilorId: string | null;
  tokenVersion: number;
}

export interface HealthComponent {
  status: 'up' | 'down';
  latencyMs: number;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: Record<string, HealthComponent>;
}
