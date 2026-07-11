import type { CredentialType } from '@pharmaqms/shared';
import type { TenantDocument } from './schemas/tenant.schema';

export interface EffectiveJwtTtlSettings {
  accessTtl: string;
  refreshTtlDefault: string;
  refreshTtlRemembered: string;
}

// PLT-8: session-timeout settings are tenant-configurable (SPEC.md §5.3); JWT *secrets* are not
// (see AuthService/EsignService — always sourced from the platform env config). Falls back to
// the platform defaults when no tenant document exists, so existing callers/tests that never
// provision a Tenant keep working unchanged.
export function resolveJwtTtlSettings(
  tenant: TenantDocument | null,
  defaults: EffectiveJwtTtlSettings,
): EffectiveJwtTtlSettings {
  if (!tenant) {
    return defaults;
  }
  return {
    accessTtl: `${tenant.settings.accessTokenTtlMinutes}m`,
    refreshTtlDefault: `${tenant.settings.refreshTokenTtlHoursDefault}h`,
    refreshTtlRemembered: `${tenant.settings.refreshTokenTtlDaysRemembered}d`,
  };
}

export function resolveSignatureCredentialType(
  tenant: TenantDocument | null,
  defaultCredentialType: CredentialType,
): CredentialType {
  return tenant ? tenant.settings.signatureCredentialType : defaultCredentialType;
}
