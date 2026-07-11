import { registerAs } from '@nestjs/config';
import type { PasswordPolicy } from '@pharmaqms/shared';

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    // PLT-1 / SPEC.md §5.3 "session timeout configurable": rememberDevice picks the long TTL,
    // mirroring the "long refresh token on registered devices" mobile UX called out for EQP.
    refreshTtlDefault: string;
    refreshTtlRemembered: string;
  };
  lockout: {
    maxAttempts: number;
    durationMinutes: number;
  };
  passwordPolicy: PasswordPolicy;
}

export const authConfig = registerAs<AuthConfig>('auth', () => ({
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    refreshTtlDefault: process.env.JWT_REFRESH_TTL_DEFAULT ?? '12h',
    refreshTtlRemembered: process.env.JWT_REFRESH_TTL_REMEMBERED ?? '30d',
  },
  lockout: {
    maxAttempts: Number(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? 5),
    durationMinutes: Number(process.env.AUTH_LOCKOUT_DURATION_MINUTES ?? 30),
  },
  passwordPolicy: {
    minLength: Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 8),
    requireUppercase: (process.env.AUTH_PASSWORD_REQUIRE_UPPERCASE ?? 'true') === 'true',
    requireLowercase: (process.env.AUTH_PASSWORD_REQUIRE_LOWERCASE ?? 'true') === 'true',
    requireNumber: (process.env.AUTH_PASSWORD_REQUIRE_NUMBER ?? 'true') === 'true',
    requireSpecialChar: (process.env.AUTH_PASSWORD_REQUIRE_SPECIAL_CHAR ?? 'true') === 'true',
    // 0 = never expires. Tenant-level override arrives with PLT-8 (tenant/user admin).
    expiryDays: Number(process.env.AUTH_PASSWORD_EXPIRY_DAYS ?? 90),
  },
}));
