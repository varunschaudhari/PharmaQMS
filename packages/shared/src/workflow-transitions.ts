import { WorkflowAction } from './enums/workflow-action';
import { WorkflowInstanceStatus } from './enums/workflow-instance-status';

// PLT-4 / CLAUDE.md coding conventions: "lifecycle transitions... implemented as explicit
// transition maps in packages/shared — an invalid transition throws; never set status fields
// directly." This validates which ACTIONS are legal from a given status (e.g. you cannot REJECT
// a DRAFT, or act on an already-APPROVED instance at all). It does not compute the destination
// status/step — that depends on template configuration (step count, reject-to-step) and stays in
// WorkflowService, which is the one place allowed to actually set instance.status.
export const WORKFLOW_ALLOWED_ACTIONS: Record<WorkflowInstanceStatus, readonly WorkflowAction[]> = {
  [WorkflowInstanceStatus.DRAFT]: [WorkflowAction.SUBMIT],
  [WorkflowInstanceStatus.IN_PROGRESS]: [WorkflowAction.APPROVE, WorkflowAction.REJECT, WorkflowAction.REASSIGN],
  [WorkflowInstanceStatus.APPROVED]: [],
};

export function isWorkflowActionAllowed(status: WorkflowInstanceStatus, action: WorkflowAction): boolean {
  return WORKFLOW_ALLOWED_ACTIONS[status].includes(action);
}

// Throws a plain Error — packages/shared is framework-agnostic (used by both server and client);
// the server wraps this in an AppException with the appropriate ErrorCode/HttpStatus.
export function assertWorkflowActionAllowed(status: WorkflowInstanceStatus, action: WorkflowAction): void {
  if (!isWorkflowActionAllowed(status, action)) {
    throw new Error(`Invalid workflow transition: "${action}" is not allowed from status "${status}".`);
  }
}
