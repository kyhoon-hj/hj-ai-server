import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePilotManifest } from '../provision-console-pilot.mjs';

const fixture = () => ({ worksOrganizationId: '11111111-1111-4111-8111-111111111111', displayName: 'Pilot', members: [{ worksUserId: '22222222-2222-4222-8222-222222222222', worksRole: 'MEMBER', permissions: ['apps:read'] }], appInfoIds: [] });
test('pilot rejects unknown permissions, duplicate identities and ambiguous ownership before DB writes', () => {
  const unknown = fixture(); unknown.members[0].permissions.push('admin:*');
  assert.throws(() => validatePilotManifest(unknown), /permission/);
  const duplicate = fixture(); duplicate.members.push({ ...duplicate.members[0] });
  assert.throws(() => validatePilotManifest(duplicate), /Duplicate/);
  const ownership = fixture(); ownership.appInfoIds = [ownership.worksOrganizationId, ownership.worksOrganizationId];
  assert.throws(() => validatePilotManifest(ownership), /duplicate app ownership/);
  assert.deepEqual(validatePilotManifest(fixture()), fixture());
});
