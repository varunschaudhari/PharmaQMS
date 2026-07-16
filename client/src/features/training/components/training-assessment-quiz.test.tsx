import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrainingAssessmentQuiz } from './training-assessment-quiz';

const { fetchTrainingAssessmentForTrainee, submitTrainingAssessmentAttempt } = vi.hoisted(() => ({
  fetchTrainingAssessmentForTrainee: vi.fn(),
  submitTrainingAssessmentAttempt: vi.fn(),
}));
vi.mock('../../../lib/training-assessment-api', () => ({ fetchTrainingAssessmentForTrainee, submitTrainingAssessmentAttempt }));

function renderQuiz(onPassed = vi.fn(), onCancel = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TrainingAssessmentQuiz assignmentId="assign-1" onPassed={onPassed} onCancel={onCancel} />
    </QueryClientProvider>,
  );
}

describe('TRN-6 TrainingAssessmentQuiz', () => {
  it('TRN-6: submitting a passing attempt calls onPassed', async () => {
    const user = userEvent.setup();
    const onPassed = vi.fn();
    fetchTrainingAssessmentForTrainee.mockResolvedValue({
      assessmentId: 'assess-1',
      passMarkPercentage: 80,
      questions: [{ id: 'q1', questionText: 'What is the required cleaning frequency?', options: ['Daily', 'Weekly'] }],
    });
    submitTrainingAssessmentAttempt.mockResolvedValue({
      attempt: { id: 'att-1', tenantId: 't1', assignmentId: 'assign-1', assessmentId: 'assess-1', userId: 'u1', attemptNumber: 1, answers: [], scorePercentage: 100, passed: true, occurredAt: '2026-07-11T00:00:00.000Z' },
      attemptsRemaining: 2,
      maxAttemptsReached: false,
    });

    renderQuiz(onPassed);
    await waitFor(() => expect(screen.getByText(/What is the required cleaning frequency/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    await user.click(screen.getByLabelText('Daily'));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onPassed).toHaveBeenCalled());
    expect(submitTrainingAssessmentAttempt).toHaveBeenCalledWith('assign-1', { answers: [{ questionId: 'q1', selectedOptionIndex: 0 }] });
  });

  it('TRN-6: a failing attempt shows the score and remaining attempts, without calling onPassed', async () => {
    const user = userEvent.setup();
    const onPassed = vi.fn();
    fetchTrainingAssessmentForTrainee.mockResolvedValue({
      assessmentId: 'assess-1',
      passMarkPercentage: 80,
      questions: [{ id: 'q1', questionText: 'What is the required cleaning frequency?', options: ['Daily', 'Weekly'] }],
    });
    submitTrainingAssessmentAttempt.mockResolvedValue({
      attempt: { id: 'att-1', tenantId: 't1', assignmentId: 'assign-1', assessmentId: 'assess-1', userId: 'u1', attemptNumber: 1, answers: [], scorePercentage: 0, passed: false, occurredAt: '2026-07-11T00:00:00.000Z' },
      attemptsRemaining: 1,
      maxAttemptsReached: false,
    });

    renderQuiz(onPassed);
    await waitFor(() => expect(screen.getByText(/What is the required cleaning frequency/)).toBeInTheDocument());
    await user.click(screen.getByLabelText('Weekly'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getByText(/Score: 0%/)).toBeInTheDocument());
    expect(screen.getByText(/1 attempt\(s\) remaining/)).toBeInTheDocument();
    expect(onPassed).not.toHaveBeenCalled();
  });
});
