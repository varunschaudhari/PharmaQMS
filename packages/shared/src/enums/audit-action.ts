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
  // DOC-2: recorded against the Document when a new version is drafted.
  VERSION_CREATED = 'version_created',
  // DOC-4: who printed which controlled-copy version, when.
  CONTROLLED_COPY_PRINTED = 'controlled_copy_printed',
  // DOC-9: recorded against the Document when its training distribution list changes.
  DISTRIBUTION_UPDATED = 'distribution_updated',
  // TRN-1/TRN-3: recorded against the TrainingAssignment.
  TRAINING_ASSIGNED = 'training_assigned',
  // TRN-2: recorded against the TrainingAssignment when the e-signed read-and-understood
  // flow completes.
  TRAINING_COMPLETED = 'training_completed',
  // EQP-4: recorded against the Equipment when a calibration schedule is created/updated, or a
  // result is recorded.
  CALIBRATION_SCHEDULED = 'calibration_scheduled',
  CALIBRATION_RECORDED = 'calibration_recorded',
  // EQP-4: QA verification e-sign (PASS results).
  CALIBRATION_VERIFIED = 'calibration_verified',
  // EQP-5: QA disposition e-sign (FAIL/OOT results).
  CALIBRATION_DISPOSITIONED = 'calibration_dispositioned',
  // EQP-6: recorded against the Equipment for every logbook entry (including amendments).
  LOGBOOK_ENTRY_LOGGED = 'logbook_entry_logged',
  // EQP-7: recorded against the Equipment for the maintenance task lifecycle.
  MAINTENANCE_TASK_CREATED = 'maintenance_task_created',
  MAINTENANCE_TASK_CLOSED = 'maintenance_task_closed',
  MAINTENANCE_TASK_VERIFIED = 'maintenance_task_verified',
  // EQP-8: recorded against the Equipment for every qualification event (and its report attach).
  QUALIFICATION_RECORDED = 'qualification_recorded',
  QUALIFICATION_REPORT_ATTACHED = 'qualification_report_attached',
  // EQP-9: recorded against the Equipment for the PM plan/task lifecycle.
  PM_PLAN_UPSERTED = 'pm_plan_upserted',
  PM_TASK_GENERATED = 'pm_task_generated',
  PM_TASK_COMPLETED = 'pm_task_completed',
}
