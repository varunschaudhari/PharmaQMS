import type { CredentialType } from '../enums/credential-type';

// PLT-8: tenant-configurable settings (SPEC.md §5.4 timezone; §5.2 e-sign mode; §5.3 session
// timeouts). JWT *secrets* remain a platform/env concern, never tenant-stored.
export interface TenantSettings {
  timezone: string;
  signatureCredentialType: CredentialType;
  accessTokenTtlMinutes: number;
  refreshTokenTtlHoursDefault: number;
  refreshTokenTtlDaysRemembered: number;
}

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  settings: TenantSettings;
  isActive: boolean;
}

export interface DepartmentData {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  isActive: boolean;
}

// Public, admin-facing user view — never includes passwordHash/tokenVersion.
export interface UserAdminData {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  roleId: string;
  departmentId: string | null;
  isActive: boolean;
  isPlatformAdmin: boolean;
}

export interface RoleSummary {
  id: string;
  name: string;
}
