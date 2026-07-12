import { z } from 'zod';
import { CredentialType } from '../enums/credential-type';
import { NotificationEmailMode } from '../enums/notification-email-mode';

const tenantSettingsSchema = z.object({
  timezone: z.string().min(1).default('Asia/Kolkata'),
  signatureCredentialType: z.nativeEnum(CredentialType).default(CredentialType.PASSWORD),
  accessTokenTtlMinutes: z.coerce.number().int().min(1).default(15),
  refreshTokenTtlHoursDefault: z.coerce.number().int().min(1).default(12),
  refreshTokenTtlDaysRemembered: z.coerce.number().int().min(1).default(30),
  // PLT-6: digest option per tenant.
  notificationEmailMode: z.nativeEnum(NotificationEmailMode).default(NotificationEmailMode.IMMEDIATE),
  // TRN-5: default grace period chosen to match a typical GMP SOP read-and-understood window.
  trainingGracePeriodDays: z.coerce.number().int().min(1).default(7),
  // EQP-4: default true — a GxP system should default to the safer, blocking behavior.
  blockUsageWhenCalibrationOverdue: z.coerce.boolean().default(true),
  // EQP-7: null until the tenant designates a maintenance Role.
  maintenanceRoleId: z.string().min(1).nullable().default(null),
  // EQP-7: default true — the safer GxP default, matching blockUsageWhenCalibrationOverdue.
  requireMaintenanceVerification: z.coerce.boolean().default(true),
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

// PLT-8: tenant provisioning always creates the tenant's first (tenant-admin) user in the same
// call — a freshly provisioned tenant otherwise has no way to log in and create its own users.
export const createTenantRequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  slug: z
    .string()
    .min(1, 'slug is required')
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only'),
  settings: tenantSettingsSchema.partial().optional(),
  initialAdmin: z.object({
    email: z.string().email(),
    fullName: z.string().min(1),
    password: z.string().min(1),
  }),
});
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const updateTenantSettingsRequestSchema = z.object({
  settings: tenantSettingsSchema.partial(),
});
export type UpdateTenantSettingsRequest = z.infer<typeof updateTenantSettingsRequestSchema>;

export const createDepartmentRequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  code: z
    .string()
    .min(1, 'code is required')
    .regex(/^[A-Za-z0-9]+$/, 'code must be alphanumeric'),
});
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  headUserId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;

export const createUserRequestSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(1),
  roleId: z.string().min(1, 'roleId is required'),
  departmentId: z.string().min(1).optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  fullName: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  departmentId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
