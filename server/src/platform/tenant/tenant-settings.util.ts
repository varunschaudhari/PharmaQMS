import {
  DEFAULT_WHATSAPP_TEMPLATE_NAMES,
  NotificationChannel,
  NotificationEmailMode,
  type CredentialType,
  type WhatsAppTemplateKey,
} from '@pharmaqms/shared';
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

// PLT-6-WA: defaults to email-only when no tenant document exists OR the tenant has never
// configured this setting — this is the invariant that keeps existing/default tenants' email
// behavior completely unchanged by WhatsApp's introduction.
export function resolveNotificationChannels(tenant: TenantDocument | null): NotificationChannel[] {
  return tenant?.settings.notificationChannels ?? [NotificationChannel.EMAIL];
}

// PLT-6-WA: a tenant's own Meta template-name override, falling back to the platform default.
export function resolveWhatsAppTemplateName(tenant: TenantDocument | null, templateKey: WhatsAppTemplateKey): string {
  return tenant?.settings.whatsappTemplateNames?.[templateKey] ?? DEFAULT_WHATSAPP_TEMPLATE_NAMES[templateKey];
}

// TRN-6: default matches the platform default (80%) when no tenant document exists.
export function resolveTrainingAssessmentPassMarkPercentage(tenant: TenantDocument | null): number {
  return tenant?.settings.trainingAssessmentPassMarkPercentage ?? 80;
}

// TRN-6: default matches the platform default (3 attempts) when no tenant document exists.
export function resolveTrainingAssessmentMaxAttempts(tenant: TenantDocument | null): number {
  return tenant?.settings.trainingAssessmentMaxAttempts ?? 3;
}
