import { z } from 'zod';

// PLT-2: pagination query for GET /audit/:entityType/:entityId/history.
export const auditHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;
