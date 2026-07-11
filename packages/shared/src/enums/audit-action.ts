// PLT-2: the "what happened" verb captured on every audit event (SPEC.md §5.1).
export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  STATUS_CHANGE = 'status_change',
  // Hard delete is permitted only for never-submitted drafts (Iron Rule 3) — still audited.
  DELETE = 'delete',
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  ACCOUNT_LOCKED = 'account_locked',
  PASSWORD_CHANGED = 'password_changed',
  // PLT-4: recorded against the business entity being approved (entityType/entityId), not a
  // separate 'WorkflowInstance' entity — so a document's own history shows workflow events
  // interleaved with direct edits.
  WORKFLOW_SUBMITTED = 'workflow_submitted',
  WORKFLOW_STEP_APPROVED = 'workflow_step_approved',
  WORKFLOW_APPROVED = 'workflow_approved',
  WORKFLOW_REJECTED = 'workflow_rejected',
  WORKFLOW_REASSIGNED = 'workflow_reassigned',
}
