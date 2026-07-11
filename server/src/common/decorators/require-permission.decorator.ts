import { SetMetadata } from '@nestjs/common';
import type { PermissionAction, PermissionKey, PermissionModule } from '@pharmaqms/shared';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

// PLT-1: declares the module:action permission a route requires; enforced by PermissionsGuard.
export const RequirePermission = (module: PermissionModule, action: PermissionAction) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, `${module}:${action}` as PermissionKey);
