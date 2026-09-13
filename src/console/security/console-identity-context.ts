import type { CorrelatedRequest } from '../../common/http/correlation-id.middleware';

export const CONSOLE_PERMISSIONS = [
  'apps:read',
  'apps:write',
  'credentials:read',
  'credentials:rotate',
  'credentials:revoke',
  'usage:read',
  'logs:read',
  'knowledge:read',
  'knowledge:write',
  'members:read',
  'members:manage',
  'billing:read',
  'billing:manage',
  'audit:read',
] as const;

export type ConsolePermission = (typeof CONSOLE_PERMISSIONS)[number];

export interface ConsoleIdentityContext {
  authenticationSource: 'works-session' | 'test-fixture';
  identityId: string;
  worksUserId: string;
  identityStatus: 'ACTIVE' | 'DISABLED';
  organizationId: string;
  worksOrganizationId: string;
  organizationStatus: 'ACTIVE' | 'DISABLED';
  membershipId: string;
  membershipStatus: 'ACTIVE' | 'REMOVED';
  permissions: readonly ConsolePermission[];
}

export type ConsoleRequest = CorrelatedRequest & {
  params?: Record<string, string | undefined>;
  consoleIdentity?: ConsoleIdentityContext;
};
