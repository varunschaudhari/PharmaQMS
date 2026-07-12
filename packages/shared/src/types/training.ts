import type { TrainingAssignmentStatus } from '../enums/training';

// TRN-1/TRN-2/TRN-3/TRN-4/TRN-5: one employee's obligation to read-and-understand one document
// VERSION. A PENDING row is unique per (tenant, user, document) — see the schema comment for why
// retraining updates it in place instead of stacking duplicates, while COMPLETED rows are never
// touched again (Iron Rule 3: the training record is the audit answer, permanent history).
export interface TrainingAssignmentData {
  id: string;
  tenantId: string;
  userId: string;
  userFullName: string;
  documentId: string;
  docNumber: string;
  documentTitle: string;
  versionId: string;
  versionLabel: string;
  status: TrainingAssignmentStatus;
  assignedAt: string;
  // Derived: assignedAt + tenant.settings.trainingGracePeriodDays. Null once completed (a
  // completed record doesn't age).
  dueDate: string | null;
  isOverdue: boolean;
  completedAt: string | null;
}

// TRN-1: the admin overview — role/department × document mapping (DOC-9), with live completion
// counts. The mapping itself is edited on the document (DOC-9's own endpoint); this is read-only.
export interface TrainingMatrixEntryData {
  documentId: string;
  docNumber: string;
  title: string;
  distributionRoleIds: string[];
  distributionDepartmentIds: string[];
  hasEffectiveVersion: boolean;
  totalAssigned: number;
  totalCompleted: number;
  totalOverdue: number;
}

// DOC-9 + TRN-3: broadcast whenever a document's training audience or its currently-required
// version changes — fired both by editing the distribution list and by a version becoming
// Effective. Carries a full snapshot so PLT-6/TRN never has to read the Documents module's own
// schema directly (CLAUDE.md: business modules never depend on one another).
export const DOCUMENT_TRAINING_TARGET_CHANGED_EVENT = 'document.training-target-changed';

export interface DocumentTrainingTargetChangedEvent {
  tenantId: string;
  documentId: string;
  docNumber: string;
  title: string;
  effectiveVersionId: string | null;
  effectiveVersionLabel: string | null;
  distributionRoleIds: string[];
  distributionDepartmentIds: string[];
}

// TRN-1: "adding a user to a role auto-generates their pending training items" — emitted by
// PLT-8's UserAdminService on user creation and on any role/department change.
export const USER_ROLE_ASSIGNED_EVENT = 'user.role-assigned';

export interface UserRoleAssignedEvent {
  tenantId: string;
  userId: string;
  roleId: string;
  departmentId: string | null;
}
