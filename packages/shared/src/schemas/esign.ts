import { z } from 'zod';
import { SignatureMeaning } from '../enums/signature-meaning';

// PLT-3: `credential` is the tenant-configured fresh re-auth factor — password today; PIN is a
// documented future extension (see server esign.config.ts).
export const signatureChallengeRequestSchema = z.object({
  credential: z.string().min(1, 'credential is required'),
});
export type SignatureChallengeRequest = z.infer<typeof signatureChallengeRequestSchema>;

export const createSignatureRequestSchema = z.object({
  signingToken: z.string().min(1, 'signingToken is required'),
  meaning: z.nativeEnum(SignatureMeaning),
  entityType: z.string().min(1, 'entityType is required'),
  entityId: z.string().min(1, 'entityId is required'),
  entitySnapshot: z.record(z.unknown()),
  reason: z.string().optional(),
});
export type CreateSignatureRequest = z.infer<typeof createSignatureRequestSchema>;
