import { TrainingAssessmentStatus } from './enums/training-assessment';

// TRN-6 lifecycle, as an explicit transition map per CLAUDE.md. Approved is terminal in the sense
// that it never reverts on its own — editing an Approved assessment's questions resets it back to
// Draft (see TrainingAssessmentService.upsertAssessment), which is a distinct write path, not a
// transition through this map.
export const TRAINING_ASSESSMENT_STATUS_TRANSITIONS: Record<TrainingAssessmentStatus, readonly TrainingAssessmentStatus[]> = {
  [TrainingAssessmentStatus.DRAFT]: [TrainingAssessmentStatus.APPROVED],
  [TrainingAssessmentStatus.APPROVED]: [],
};

export function isTrainingAssessmentStatusTransitionAllowed(
  from: TrainingAssessmentStatus,
  to: TrainingAssessmentStatus,
): boolean {
  return TRAINING_ASSESSMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function assertTrainingAssessmentStatusTransition(from: TrainingAssessmentStatus, to: TrainingAssessmentStatus): void {
  if (!isTrainingAssessmentStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid training assessment status transition: ${from} -> ${to}`);
  }
}
