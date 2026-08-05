import { SetMetadata } from '@nestjs/common';

export const ADMIN_ROLES_KEY = 'admin_roles';
export const ADMIN_ROLES = ['platform-admin', 'knowledge-operator'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const AdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);
