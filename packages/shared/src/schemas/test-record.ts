import { z } from 'zod';

// Phase 0 gate demo entity — see types/test-record.ts.
export const createTestRecordRequestSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().min(1, 'description is required'),
});
export type CreateTestRecordRequest = z.infer<typeof createTestRecordRequestSchema>;

export const updateTestRecordRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
export type UpdateTestRecordRequest = z.infer<typeof updateTestRecordRequestSchema>;
