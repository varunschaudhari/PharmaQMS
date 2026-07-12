import { z } from 'zod';

// PLT-7: get-or-create the QR code for an entity. Idempotent per (entityType, entityId) —
// re-posting returns the existing code, never mints a second one for the same entity.
export const createQrCodeRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  entityId: z.string().min(1, 'entityId is required'),
  entityCode: z.string().min(1, 'entityCode is required'),
  entityName: z.string().min(1, 'entityName is required'),
});
export type CreateQrCodeRequest = z.infer<typeof createQrCodeRequestSchema>;

// PLT-7: label PDF sizes — 'single' is one adhesive label; 'a4' is a cut-out grid of the same
// label filling an A4 sheet.
export const qrLabelQuerySchema = z.object({
  size: z.enum(['single', 'a4']).default('single'),
});
export type QrLabelQuery = z.infer<typeof qrLabelQuerySchema>;
