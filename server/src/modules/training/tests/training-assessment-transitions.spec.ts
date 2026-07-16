import {
  assertTrainingAssessmentStatusTransition,
  isTrainingAssessmentStatusTransitionAllowed,
  TRAINING_ASSESSMENT_STATUS_TRANSITIONS,
  TrainingAssessmentStatus,
} from '@pharmaqms/shared';

describe('TRN-6 training assessment status transition map', () => {
  it('TRN-6: Draft can move to Approved', () => {
    expect(TRAINING_ASSESSMENT_STATUS_TRANSITIONS[TrainingAssessmentStatus.DRAFT]).toEqual([TrainingAssessmentStatus.APPROVED]);
  });

  it('TRN-6: Approved is terminal through this map (editing resets to Draft via a separate write path)', () => {
    expect(TRAINING_ASSESSMENT_STATUS_TRANSITIONS[TrainingAssessmentStatus.APPROVED]).toEqual([]);
    expect(() => assertTrainingAssessmentStatusTransition(TrainingAssessmentStatus.APPROVED, TrainingAssessmentStatus.DRAFT)).toThrow(
      /Invalid training assessment status transition/,
    );
  });

  it('TRN-6: Draft -> Approved is allowed; Approved -> Draft is not (via this map)', () => {
    expect(isTrainingAssessmentStatusTransitionAllowed(TrainingAssessmentStatus.DRAFT, TrainingAssessmentStatus.APPROVED)).toBe(true);
    expect(isTrainingAssessmentStatusTransitionAllowed(TrainingAssessmentStatus.APPROVED, TrainingAssessmentStatus.DRAFT)).toBe(false);
  });
});
