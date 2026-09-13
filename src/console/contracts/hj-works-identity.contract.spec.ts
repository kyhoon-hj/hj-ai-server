import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HjWorksIdentityContractError,
  parseHjWorksSsoV1Identity,
} from './hj-works-identity.contract';

const NOW = new Date('2030-01-01T00:00:00.000Z');
const fixture = () =>
  JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'src',
        'console',
        'contracts',
        'fixtures',
        'hj-works-sso-v1.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

describe('HJ-Works SSO v1 identity contract', () => {
  it('creates immutable issuer-scoped identity and organization bindings', () => {
    expect(parseHjWorksSsoV1Identity(fixture(), NOW)).toEqual({
      contractVersion: 'hj-works-sso-v1',
      issuer: 'HJ_WORKS',
      worksUserId: '11111111-1111-4111-8111-111111111111',
      worksOrganizationId: '22222222-2222-4222-8222-222222222222',
      membershipRole: 'ADMIN',
      email: 'console.admin@example.com',
      displayName: 'Console Admin',
      organizationName: 'HJ Console Fixture',
      organizationSlug: 'hj-console-fixture',
      expiresAt: new Date('2030-01-01T00:01:00.000Z'),
    });
  });

  it('rejects mismatched duplicate identity and organization IDs', () => {
    const userMismatch = fixture();
    userMismatch.userId = '33333333-3333-4333-8333-333333333333';
    expect(() => parseHjWorksSsoV1Identity(userMismatch, NOW)).toThrow(
      'response userId and user.id must match',
    );

    const tenantMismatch = fixture();
    tenantMismatch.tenantId = '44444444-4444-4444-8444-444444444444';
    expect(() => parseHjWorksSsoV1Identity(tenantMismatch, NOW)).toThrow(
      'response tenantId and tenant.id must match',
    );
  });

  it.each([
    ['malformed UUID', { userId: 'not-a-uuid' }],
    ['unknown membership role', { membershipRole: 'DEVELOPER' }],
    ['expired response', { expiresAt: '2030-01-01T00:00:00.000Z' }],
  ])('rejects %s', (_case, overrides) => {
    expect(() =>
      parseHjWorksSsoV1Identity({ ...fixture(), ...overrides }, NOW),
    ).toThrow(HjWorksIdentityContractError);
  });

  it('fails closed on fields outside the versioned response contract', () => {
    expect(() =>
      parseHjWorksSsoV1Identity({ ...fixture(), permissions: [] }, NOW),
    ).toThrow('response contains unknown fields: permissions');
  });
});
