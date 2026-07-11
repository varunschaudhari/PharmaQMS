import type { PermissionKey } from '../enums/permission';

// PLT-1: tenant-configurable password policy (SPEC.md §5.3). expiryDays <= 0 means "never expires".
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
  expiryDays: number;
}

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roleId: string;
  email: string;
  fullName: string;
  permissions: PermissionKey[];
  // PLT-8: cross-tenant platform administrator (tenant provisioning) — orthogonal to the
  // tenant-scoped permission matrix, never itself tenant-configurable.
  isPlatformAdmin: boolean;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  tokenVersion: number;
  remembered: boolean;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Decoded, request-scoped identity attached by JwtAuthGuard (req.user) and used by @CurrentUser().
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roleId: string;
  email: string;
  fullName: string;
  permissions: PermissionKey[];
  isPlatformAdmin: boolean;
}

export interface LoginResponseData {
  tokens: AuthTokens;
  user: AuthenticatedUser;
  mustChangePassword: boolean;
}
