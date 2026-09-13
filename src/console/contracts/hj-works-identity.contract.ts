export const HJ_WORKS_IDENTITY_CONTRACT_VERSION = 'hj-works-sso-v1' as const;
export const HJ_WORKS_IDENTITY_ISSUER = 'HJ_WORKS' as const;

export const HJ_WORKS_MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export type HjWorksMembershipRole = (typeof HJ_WORKS_MEMBERSHIP_ROLES)[number];

export interface HjWorksIdentityBinding {
  contractVersion: typeof HJ_WORKS_IDENTITY_CONTRACT_VERSION;
  issuer: typeof HJ_WORKS_IDENTITY_ISSUER;
  worksUserId: string;
  worksOrganizationId: string;
  membershipRole: HjWorksMembershipRole;
  email: string;
  displayName: string;
  organizationName: string;
  organizationSlug: string;
  expiresAt: Date;
}

export class HjWorksIdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HjWorksIdentityContractError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOP_LEVEL_FIELDS = new Set([
  'userId',
  'tenantId',
  'membershipRole',
  'user',
  'tenant',
  'expiresAt',
]);
const USER_FIELDS = new Set(['id', 'email', 'displayName']);
const TENANT_FIELDS = new Set(['id', 'name', 'slug']);

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HjWorksIdentityContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new HjWorksIdentityContractError(
      `${path} contains unknown fields: ${unknown.join(', ')}`,
    );
  }
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  path: string,
) {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new HjWorksIdentityContractError(`${path}.${field} is required`);
  }
  return candidate.trim();
}

function requireUuid(value: string, path: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new HjWorksIdentityContractError(`${path} must be a UUID`);
  }
  return value.toLowerCase();
}

export function parseHjWorksSsoV1Identity(
  input: unknown,
  now = new Date(),
): HjWorksIdentityBinding {
  const payload = requireRecord(input, 'response');
  rejectUnknownFields(payload, TOP_LEVEL_FIELDS, 'response');

  const user = requireRecord(payload.user, 'response.user');
  const tenant = requireRecord(payload.tenant, 'response.tenant');
  rejectUnknownFields(user, USER_FIELDS, 'response.user');
  rejectUnknownFields(tenant, TENANT_FIELDS, 'response.tenant');

  const userId = requireUuid(
    requireString(payload, 'userId', 'response'),
    'response.userId',
  );
  const nestedUserId = requireUuid(
    requireString(user, 'id', 'response.user'),
    'response.user.id',
  );
  if (userId !== nestedUserId) {
    throw new HjWorksIdentityContractError(
      'response userId and user.id must match',
    );
  }

  const tenantId = requireUuid(
    requireString(payload, 'tenantId', 'response'),
    'response.tenantId',
  );
  const nestedTenantId = requireUuid(
    requireString(tenant, 'id', 'response.tenant'),
    'response.tenant.id',
  );
  if (tenantId !== nestedTenantId) {
    throw new HjWorksIdentityContractError(
      'response tenantId and tenant.id must match',
    );
  }

  const membershipRole = requireString(payload, 'membershipRole', 'response');
  if (!HJ_WORKS_MEMBERSHIP_ROLES.includes(membershipRole as never)) {
    throw new HjWorksIdentityContractError(
      'response.membershipRole is not supported',
    );
  }

  const email = requireString(user, 'email', 'response.user');
  if (!EMAIL_PATTERN.test(email)) {
    throw new HjWorksIdentityContractError(
      'response.user.email must be a valid email address',
    );
  }

  const expiresAtValue = requireString(payload, 'expiresAt', 'response');
  const expiresAt = new Date(expiresAtValue);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new HjWorksIdentityContractError(
      'response.expiresAt must be a future ISO timestamp',
    );
  }

  return {
    contractVersion: HJ_WORKS_IDENTITY_CONTRACT_VERSION,
    issuer: HJ_WORKS_IDENTITY_ISSUER,
    worksUserId: userId,
    worksOrganizationId: tenantId,
    membershipRole: membershipRole as HjWorksMembershipRole,
    email,
    displayName: requireString(user, 'displayName', 'response.user'),
    organizationName: requireString(tenant, 'name', 'response.tenant'),
    organizationSlug: requireString(tenant, 'slug', 'response.tenant'),
    expiresAt,
  };
}
