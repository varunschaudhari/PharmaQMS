import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// PLT-1: marks a route as exempt from JwtAuthGuard/TenantGuard/PermissionsGuard (e.g. login, refresh).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
