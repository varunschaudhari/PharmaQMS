import { registerAs } from '@nestjs/config';
import { CredentialType } from '@pharmaqms/shared';

const MAX_SIGNING_TOKEN_TTL_SECONDS = 120;

export interface EsignConfig {
  // Platform default, tenant-overridable per SPEC.md §5.2 (PLT-8 Tenant.settings). 'pin' is a
  // documented future extension — see EsignService.challenge() — requiring a `pinHash` field on
  // User (PLT-8 territory).
  credentialType: CredentialType;
  signingTokenSecret: string;
  // Hard-capped at 120s (≤2 min per SPEC.md §5.2) regardless of env misconfiguration. Not
  // tenant-configurable — a security-critical ceiling, deliberately not loosenable per tenant.
  signingTokenTtlSeconds: number;
}

export const esignConfig = registerAs<EsignConfig>('esign', () => ({
  credentialType: process.env.SIGNATURE_CREDENTIAL_TYPE === 'pin' ? CredentialType.PIN : CredentialType.PASSWORD,
  signingTokenSecret: process.env.JWT_SIGNING_SECRET ?? 'dev-signing-secret-change-me',
  signingTokenTtlSeconds: Math.min(
    Number(process.env.SIGNING_TOKEN_TTL_SECONDS ?? MAX_SIGNING_TOKEN_TTL_SECONDS),
    MAX_SIGNING_TOKEN_TTL_SECONDS,
  ),
}));
