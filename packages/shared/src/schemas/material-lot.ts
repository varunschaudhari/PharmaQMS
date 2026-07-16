import { z } from 'zod';
import { MaterialLotStatus } from '../enums/material-lot';

// QRX-2: material lot master create — status always starts at Quarantine (never settable at
// creation; a fresh lot has not been dispositioned yet).
export const createMaterialLotRequestSchema = z.object({
  materialName: z.string().min(1, 'materialName is required'),
  manufacturer: z.string().optional(),
  receivedDate: z.string().min(1, 'receivedDate is required'),
});
export type CreateMaterialLotRequest = z.infer<typeof createMaterialLotRequestSchema>;

export const listMaterialLotsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(MaterialLotStatus).optional(),
  search: z.string().optional(),
});
export type ListMaterialLotsQuery = z.infer<typeof listMaterialLotsQuerySchema>;

// QRX-2: the ONLY way status changes — QA-permission-gated AND e-signed (meaning "QA
// Disposition"), never a direct field write. `signingToken` is read by SignatureGuard directly
// off the request body (same convention as EQP-4/5's calibration verify/disposition schemas).
export const transitionMaterialLotStatusRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  status: z.nativeEnum(MaterialLotStatus),
  note: z.string().optional(),
});
export type TransitionMaterialLotStatusRequest = z.infer<typeof transitionMaterialLotStatusRequestSchema>;
