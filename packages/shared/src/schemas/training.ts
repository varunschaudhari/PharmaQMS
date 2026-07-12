import { z } from 'zod';

// TRN-2: read-and-understood completion is e-signed (PLT-3) — no extra fields; the meaning is
// fixed to "Trained — read and understood" server-side.
export const completeTrainingAssignmentRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
});
export type CompleteTrainingAssignmentRequest = z.infer<typeof completeTrainingAssignmentRequestSchema>;
