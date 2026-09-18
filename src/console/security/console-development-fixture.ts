import type { ConfigService } from '@nestjs/config';
import {
  CONSOLE_PERMISSIONS,
  type ConsoleIdentityContext,
} from './console-identity-context';

export const DEVELOPMENT_CONSOLE_IDENTITY: ConsoleIdentityContext = {
  authenticationSource: 'test-fixture',
  identityId: '11111111-1111-4111-8111-111111111111',
  worksUserId: '22222222-2222-4222-8222-222222222222',
  identityStatus: 'ACTIVE',
  organizationId: '33333333-3333-4333-8333-333333333333',
  worksOrganizationId: '44444444-4444-4444-8444-444444444444',
  organizationStatus: 'ACTIVE',
  membershipId: '55555555-5555-4555-8555-555555555555',
  membershipStatus: 'ACTIVE',
  permissions: CONSOLE_PERMISSIONS,
};

export function isDevelopmentConsoleFixtureEnabled(
  config: Pick<ConfigService, 'get'>,
) {
  return (
    config.get<string>('NODE_ENV') === 'development' &&
    config.get<string>('ENABLE_CONSOLE_DEV_IDENTITY') === 'true'
  );
}
