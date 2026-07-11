// API request types are always imported from shared, never redefined (CLAUDE.md).
export {
  createWorkflowTemplateRequestSchema,
  updateWorkflowTemplateRequestSchema,
  submitWorkflowRequestSchema,
  actOnWorkflowStepRequestSchema,
  type CreateWorkflowTemplateRequest,
  type UpdateWorkflowTemplateRequest,
  type SubmitWorkflowRequest,
  type ActOnWorkflowStepRequest,
} from '@pharmaqms/shared';
