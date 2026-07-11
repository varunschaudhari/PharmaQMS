import { z } from 'zod';
import type { PasswordPolicy } from '../types/auth';

export const loginRequestSchema = z.object({
  // PLT-1: tenantId is client-supplied only at this unauthenticated boundary — there is no
  // session yet to derive it from. Every other endpoint must derive tenantId from the verified
  // JWT (never from the request body/params), per SPEC.md §6 tenant-isolation requirement.
  tenantId: z.string().min(1, 'tenantId is required'),
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'password is required'),
  rememberDevice: z.boolean().optional().default(false),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

// PLT-1: added alongside PLT-2 so login/lockout/password-change auth events can all be wired
// into the audit trail. newPassword complexity is re-checked server-side against the tenant's
// live PasswordPolicy via buildPasswordComplexitySchema (policy isn't known statically here).
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(1, 'newPassword is required'),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// PLT-1: reusable password complexity validator, built from a tenant's configured PasswordPolicy.
export function buildPasswordComplexitySchema(policy: PasswordPolicy): z.ZodType<string> {
  let schema: z.ZodType<string> = z
    .string()
    .min(policy.minLength, `Password must be at least ${policy.minLength} characters`);

  if (policy.requireUppercase) {
    schema = schema.refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter');
  }
  if (policy.requireLowercase) {
    schema = schema.refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter');
  }
  if (policy.requireNumber) {
    schema = schema.refine((value) => /[0-9]/.test(value), 'Password must contain a number');
  }
  if (policy.requireSpecialChar) {
    schema = schema.refine(
      (value) => /[^A-Za-z0-9]/.test(value),
      'Password must contain a special character',
    );
  }
  return schema;
}
