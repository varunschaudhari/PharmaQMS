import { z } from 'zod';
import { SignatureMeaning } from '../enums/signature-meaning';
import { WorkflowAction } from '../enums/workflow-action';

const workflowTemplateStepSchema = z.object({
  name: z.string().min(1, 'name is required'),
  roleId: z.string().min(1, 'roleId is required'),
  signatureMeaning: z.nativeEnum(SignatureMeaning),
  rejectToStepIndex: z.number().int().min(0).nullable().optional().default(null),
});

export const createWorkflowTemplateRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  name: z.string().min(1, 'name is required'),
  steps: z.array(workflowTemplateStepSchema).min(1, 'At least one step is required'),
});
export type CreateWorkflowTemplateRequest = z.infer<typeof createWorkflowTemplateRequestSchema>;

export const updateWorkflowTemplateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  steps: z.array(workflowTemplateStepSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWorkflowTemplateRequest = z.infer<typeof updateWorkflowTemplateRequestSchema>;

export const submitWorkflowRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  entityId: z.string().min(1, 'entityId is required'),
});
export type SubmitWorkflowRequest = z.infer<typeof submitWorkflowRequestSchema>;

// PLT-4: approve requires e-sign via PLT-3 — a fresh signingToken, not just a valid session
// (Iron Rule 4). Reject requires a mandatory comment; reassign (admin) requires a reason.
export const actOnWorkflowStepRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal(WorkflowAction.APPROVE),
    signingToken: z.string().min(1, 'signingToken is required'),
    entitySnapshot: z.record(z.unknown()),
    comment: z.string().optional(),
  }),
  z.object({
    action: z.literal(WorkflowAction.REJECT),
    comment: z.string().min(1, 'A comment is required to reject.'),
  }),
  z.object({
    action: z.literal(WorkflowAction.REASSIGN),
    userId: z.string().min(1, 'userId is required'),
    reason: z.string().min(1, 'A reason is required to reassign.'),
  }),
]);
export type ActOnWorkflowStepRequest = z.infer<typeof actOnWorkflowStepRequestSchema>;
