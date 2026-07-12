import type { WorkflowAction } from '../enums/workflow-action';
import type { WorkflowInstanceStatus } from '../enums/workflow-instance-status';
import type { SignatureMeaning } from '../enums/signature-meaning';

// PLT-4: one ordered step in a tenant-configurable approval flow (SPEC.md §6.1 / §7.1 DOC-3).
export interface WorkflowTemplateStepData {
  name: string;
  roleId: string;
  signatureMeaning: SignatureMeaning;
  // null = a rejection at this step returns the instance to DRAFT (the author); a number is the
  // index of an earlier step to re-enter IN_PROGRESS at instead.
  rejectToStepIndex: number | null;
}

export interface WorkflowTemplateData {
  id: string;
  tenantId: string;
  entityType: string;
  name: string;
  steps: WorkflowTemplateStepData[];
  isActive: boolean;
}

export interface WorkflowInstanceData {
  id: string;
  tenantId: string;
  templateId: string;
  entityType: string;
  entityId: string;
  status: WorkflowInstanceStatus;
  currentStepIndex: number;
  currentStep: WorkflowTemplateStepData | null;
  overrideAssigneeUserId: string | null;
  totalSteps: number;
}

// PLT-4: emitted on every step/assignee change; PLT-6 Notifications subscribes to fan events
// out into the per-user notification log.
export const WORKFLOW_STEP_CHANGED_EVENT = 'workflow.step-changed';

export interface WorkflowStepChangedEvent {
  tenantId: string;
  entityType: string;
  entityId: string;
  instanceId: string;
  action: WorkflowAction;
  fromStatus: WorkflowInstanceStatus;
  toStatus: WorkflowInstanceStatus;
  fromStepIndex: number;
  toStepIndex: number;
  actorId: string;
  actorFullName: string;
  comment: string | null;
  // PLT-6: recipient resolution — the role eligible for the now-current step (null when the
  // instance left IN_PROGRESS), its display name, and the specific user when reassigned.
  toStepRoleId: string | null;
  toStepName: string | null;
  overrideAssigneeUserId: string | null;
  // PLT-6: the author who submitted the instance — recipient of approved/rejected outcomes.
  submittedByUserId: string | null;
}
