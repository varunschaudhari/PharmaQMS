import type { TrainingAssignmentStatus } from '../enums/training';
import type { TrainingAssessmentStatus } from '../enums/training-assessment';

// TRN-6: derived per-assignment summary of assessment progress — null when the assignment's
// document version has no APPROVED assessment configured (the ordinary, assessment-free flow is
// completely unaffected). "Retraining required" (SPEC.md §7.2 TRN-6) is deliberately NOT a stored
// TrainingAssignmentStatus value — it's derived here (attemptCount > 0 && !passed), the same
// "derive, don't store" precedent TRN-5's own isOverdue already established.
export interface TrainingAssignmentAssessmentSummary {
  assessmentId: string;
  attemptCount: number;
  bestScorePercentage: number | null;
  passed: boolean;
  maxAttemptsReached: boolean;
}

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
  // TRN-6: null when this version has no configured assessment.
  assessment: TrainingAssignmentAssessmentSummary | null;
}

// TRN-6: one MCQ question as shown to a TRAINEE — never carries the answer key.
export interface TrainingAssessmentQuestionData {
  id: string;
  questionText: string;
  options: string[];
}

// TRN-6: the QA-authoring shape — includes the answer key. Never sent to a trainee-facing endpoint.
export interface TrainingAssessmentQuestionAuthoringData extends TrainingAssessmentQuestionData {
  correctOptionIndex: number;
}

// TRN-6: the question bank attached to one document VERSION (QA-authoring view).
export interface TrainingAssessmentData {
  id: string;
  tenantId: string;
  documentId: string;
  versionId: string;
  docNumber: string;
  versionLabel: string;
  status: TrainingAssessmentStatus;
  questions: TrainingAssessmentQuestionAuthoringData[];
  // Null for a system-generated carry-forward copy (see TrainingAssessmentService.carryForwardAssessment).
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

// TRN-6: what a trainee actually receives — randomized question order, no answer key, plus the
// pass mark so the client can show it before submitting.
export interface TrainingAssessmentForTraineeData {
  assessmentId: string;
  passMarkPercentage: number;
  questions: TrainingAssessmentQuestionData[];
}

export interface TrainingAssessmentAttemptAnswer {
  questionId: string;
  selectedOptionIndex: number;
}

// TRN-6: one immutable attempt record (score, answers, timestamp — audited, append-only).
export interface TrainingAssessmentAttemptData {
  id: string;
  tenantId: string;
  assignmentId: string;
  assessmentId: string;
  userId: string;
  attemptNumber: number;
  answers: TrainingAssessmentAttemptAnswer[];
  scorePercentage: number;
  passed: boolean;
  occurredAt: string;
}

export interface TrainingAssessmentAttemptResultData {
  attempt: TrainingAssessmentAttemptData;
  attemptsRemaining: number;
  maxAttemptsReached: boolean;
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
  // TRN-6: 0/0 when no assessment is configured for the current Effective version.
  totalAssessmentAttempts: number;
  totalAssessmentFailedMaxAttempts: number;
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
