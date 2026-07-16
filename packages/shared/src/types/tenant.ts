import type { CredentialType } from '../enums/credential-type';
import type { NotificationChannel } from '../enums/notification-channel';
import type { NotificationEmailMode } from '../enums/notification-email-mode';
import type { WhatsAppTemplateKey } from '../enums/whatsapp-template-key';

// PLT-8: tenant-configurable settings (SPEC.md §5.4 timezone; §5.2 e-sign mode; §5.3 session
// timeouts; PLT-6 notification email mode). JWT *secrets* remain a platform/env concern, never
// tenant-stored.
export interface TenantSettings {
  timezone: string;
  signatureCredentialType: CredentialType;
  accessTokenTtlMinutes: number;
  refreshTokenTtlHoursDefault: number;
  refreshTokenTtlDaysRemembered: number;
  // PLT-6: immediate per-event emails, or one daily digest per user.
  notificationEmailMode: NotificationEmailMode;
  // TRN-5: grace period (days from assignment) before a pending training becomes overdue.
  trainingGracePeriodDays: number;
  // EQP-4: whether overdue calibration blocks usage logging (with a warning) or just warns.
  blockUsageWhenCalibrationOverdue: boolean;
  // EQP-7: the Role a breakdown-triggered maintenance task is assigned to; null until configured.
  maintenanceRoleId: string | null;
  // EQP-7: whether a closed maintenance task additionally requires a QA/user verification e-sign.
  requireMaintenanceVerification: boolean;
  // PLT-6-WA: which channel(s) this tenant has enabled — defaults to email-only everywhere, so an
  // unconfigured tenant's behavior is byte-for-byte unchanged from before WhatsApp existed.
  notificationChannels: NotificationChannel[];
  // PLT-6-WA: per-tenant override of the Meta-registered template name for a given internal
  // template key (their WhatsApp Business Account may have it approved under a different name).
  // Falls back to DEFAULT_WHATSAPP_TEMPLATE_NAMES for any key not present here. Never contains
  // secrets — provider credentials (phone number id, access token) are env-only (CLAUDE.md: never
  // hardcode, never tenant-stored).
  whatsappTemplateNames: Partial<Record<WhatsAppTemplateKey, string>>;
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
  // TRN-5: overdue-training notifications go to the employee AND their department head.
  headUserId: string | null;
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
  // PLT-6-WA: E.164 phone number this user has confirmed for WhatsApp delivery; null until set.
  whatsappPhoneNumber: string | null;
  // PLT-6-WA: explicit per-user consent — a phone number alone never triggers a send.
  whatsappOptIn: boolean;
}

export interface RoleSummary {
  id: string;
  name: string;
}
