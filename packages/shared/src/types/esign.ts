import type { SignatureMeaning } from '../enums/signature-meaning';

export interface SigningTokenPayload {
  sub: string;
  tenantId: string;
  fullName: string;
  // Single-use nonce — SignatureGuard rejects any signingToken whose jti has already been consumed.
  jti: string;
  type: 'signing';
  iat?: number;
  exp?: number;
}

export interface SignatureChallengeResponse {
  signingToken: string;
  expiresAt: string;
}

// PLT-3: one immutable e-signature (SPEC.md §5.2) — who, when, meaning, and the SHA-256 hash of
// the entity snapshot at signing time.
export interface SignatureData {
  id: string;
  tenantId: string;
  userId: string;
  userFullName: string;
  meaning: SignatureMeaning;
  entityType: string;
  entityId: string;
  snapshotHash: string;
  reason: string | null;
  signedAt: string;
}
