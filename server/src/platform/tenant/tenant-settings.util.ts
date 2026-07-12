import { NotificationEmailMode, type CredentialType } from '@pharmaqms/shared';
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

// PLT-6: digest option per tenant — immediate when no tenant document exists (same graceful
// fallback as the other settings above).
export function resolveNotificationEmailMode(tenant: TenantDocument | null): NotificationEmailMode {
  return tenant?.settings.notificationEmailMode ?? NotificationEmailMode.IMMEDIATE;
}

// TRN-5: default matches the platform default (7 days) when no tenant document exists.
export function resolveTrainingGracePeriodDays(tenant: TenantDocument | null): number {
  return tenant?.settings.trainingGracePeriodDays ?? 7;
}

// EQP-4: defaults to the safer, blocking behavior when no tenant document exists.
export function resolveBlockUsageWhenCalibrationOverdue(tenant: TenantDocument | null): boolean {
  return tenant?.settings.blockUsageWhenCalibrationOverdue ?? true;
}

// EQP-7: null (unassigned) when no tenant document/setting exists yet.
export function resolveMaintenanceRoleId(tenant: TenantDocument | null): string | null {
  return tenant?.settings.maintenanceRoleId ?? null;
}

// EQP-7: defaults to the safer, verification-required behavior when no tenant document exists.
export function resolveRequireMaintenanceVerification(tenant: TenantDocument | null): boolean {
  return tenant?.settings.requireMaintenanceVerification ?? true;
}
