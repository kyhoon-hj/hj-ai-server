import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const permissions = new Set(['apps:read', 'apps:write', 'credentials:read', 'credentials:rotate', 'credentials:revoke', 'usage:read', 'logs:read', 'knowledge:read', 'knowledge:write', 'members:read', 'members:manage', 'billing:read', 'billing:manage', 'audit:read']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePilotManifest(input) {
  if (!input || !uuid.test(input.worksOrganizationId) || typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 200 || !Array.isArray(input.members) || !input.members.length || !Array.isArray(input.appInfoIds)) throw new Error('Invalid pilot organization manifest');
  const users = new Set();
  for (const member of input.members) {
    if (!member || !uuid.test(member.worksUserId) || !['OWNER', 'ADMIN', 'MEMBER'].includes(member.worksRole) || !Array.isArray(member.permissions) || member.permissions.some((permission) => !permissions.has(permission)) || new Set(member.permissions).size !== member.permissions.length) throw new Error('Invalid pilot member or permission');
    const id = member.worksUserId.toLowerCase();
    if (users.has(id)) throw new Error('Duplicate pilot user');
    users.add(id);
    member.worksUserId = id;
  }
  if (input.appInfoIds.some((id) => typeof id !== 'string' || !uuid.test(id)) || new Set(input.appInfoIds.map((id) => id.toLowerCase())).size !== input.appInfoIds.length) throw new Error('Invalid or duplicate app ownership');
  return { ...input, worksOrganizationId: input.worksOrganizationId.toLowerCase(), appInfoIds: input.appInfoIds.map((id) => id.toLowerCase()) };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const path = args.find((arg) => !arg.startsWith('--'));
  if (!path || args.some((arg) => arg.startsWith('--') && !['--apply', '--dry-run'].includes(arg)) || (apply && args.includes('--dry-run'))) throw new Error('Usage: node scripts/provision-console-pilot.mjs <manifest.json> [--dry-run | --apply]');
  const manifest = validatePilotManifest(JSON.parse(await readFile(path, 'utf8')));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.consoleOrganization.findUnique({ where: { worksOrganizationId: manifest.worksOrganizationId } });
      if (existing && existing.status !== 'ACTIVE') throw new Error('Disabled organization must be reviewed separately');
      for (const member of manifest.members) {
        const identity = await tx.consoleIdentity.findUnique({ where: { worksUserId: member.worksUserId } });
        if (identity && identity.status !== 'ACTIVE') throw new Error('Disabled identity must be reviewed separately');
        if (identity && existing) {
          const membership = await tx.consoleMembership.findUnique({ where: { organizationId_identityId: { organizationId: existing.id, identityId: identity.id } } });
          if (membership && membership.status !== 'ACTIVE') throw new Error('Removed membership must be reviewed separately');
        }
      }
      for (const id of manifest.appInfoIds) {
        const app = await tx.appInfo.findUnique({ where: { id }, include: { consoleOwnership: true } });
        if (!app) throw new Error(`AppInfo does not exist: ${id}`);
        if (app.consoleOwnership && app.consoleOwnership.organizationId !== existing?.id) throw new Error(`AppInfo belongs to another organization: ${id}`);
      }
      const report = { mode: apply ? 'apply' : 'dry-run', worksOrganizationId: manifest.worksOrganizationId, members: manifest.members.length, apps: manifest.appInfoIds.length };
      if (!apply) return report;
      const now = new Date();
      const organization = await tx.consoleOrganization.upsert({ where: { worksOrganizationId: manifest.worksOrganizationId }, create: { worksOrganizationId: manifest.worksOrganizationId, displayName: manifest.displayName, lastSyncedAt: now }, update: { displayName: manifest.displayName, lastSyncedAt: now } });
      let actorId;
      for (const member of manifest.members) {
        const identity = await tx.consoleIdentity.upsert({ where: { worksUserId: member.worksUserId }, create: { worksUserId: member.worksUserId, lastSyncedAt: now }, update: {} });
        const membership = await tx.consoleMembership.upsert({ where: { organizationId_identityId: { organizationId: organization.id, identityId: identity.id } }, create: { organizationId: organization.id, identityId: identity.id, worksRole: member.worksRole, permissions: member.permissions, lastSyncedAt: now }, update: { worksRole: member.worksRole, permissions: member.permissions, lastSyncedAt: now } });
        await tx.consoleSession.deleteMany({ where: { membershipId: membership.id } });
        actorId ??= identity.id;
      }
      for (const id of manifest.appInfoIds) {
        await tx.consoleAppOwnership.upsert({ where: { appInfoId: id }, create: { appInfoId: id, organizationId: organization.id, createdByIdentityId: actorId }, update: {} });
      }
      return report;
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
