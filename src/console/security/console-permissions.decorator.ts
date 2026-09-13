import { SetMetadata } from '@nestjs/common';
import type { ConsolePermission } from './console-identity-context';

export const CONSOLE_PERMISSIONS_KEY = 'console_permissions';
export const CONSOLE_ORGANIZATION_PARAM_KEY = 'console_organization_param';

export const ConsolePermissions = (...permissions: ConsolePermission[]) =>
  SetMetadata(CONSOLE_PERMISSIONS_KEY, permissions);

export const ConsoleOrganizationScope = (param = 'organizationId') =>
  SetMetadata(CONSOLE_ORGANIZATION_PARAM_KEY, param);
