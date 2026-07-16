import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { fetchTrainingAssessmentForTrainee, submitTrainingAssessmentAttempt } from '../../../lib/training-assessment-api';

// TRN-6 (c): mobile-first quiz — operators take these on phones (SPEC.md §7.2). Randomized
// question order (server-side), immediate scoring on submit, pass unlocks the existing TRN-2
// e-sign completion; fail shows the result and remaining attempts right here.
export function TrainingAssessmentQuiz({ assignmentId, onPassed, onCancel }: { assignmentId: string; onPassed: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ passed: boolean; scorePercentage: number; attemptsRemaining: number; maxAttemptsReached: boolean } | null>(null);

  const { data: quiz, isLoading } = useQuery({
    queryKey: ['training-assessment-quiz', assignmentId],
    queryFn: () => fetchTrainingAssessmentForTrainee(assignmentId),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitTrainingAssessmentAttempt(assignmentId, {
        answers: Object.entries(answers).map(([questionId, selectedOptionIndex]) => ({ questionId, selectedOptionIndex })),
      }),
    onSuccess: (result) => {
      setLastResult({
        passed: result.attempt.passed,
        scorePercentage: result.attempt.scorePercentage,
        attemptsRemaining: result.attemptsRemaining,
        maxAttemptsReached: result.maxAttemptsReached,
      });
      void queryClient.invalidateQueries({ queryKey: ['my-trainings'] });
      if (result.attempt.passed) {
        onPassed();
      }
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to submit the assessment.'),
  });

  if (isLoading || !quiz) {
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
          <p className="text-sm text-slate-500">Loading assessment…</p>
        </div>
      </div>
    );
  }

  const allAnswered = quiz.questions.every((q) => answers[q.id] !== undefined);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-slate-900">Assessment</h2>
        <p className="mt-1 text-xs text-slate-500">Pass mark: {quiz.passMarkPercentage}%</p>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {lastResult && !lastResult.passed && (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Score: {lastResult.scorePercentage}% — not enough to pass.</p>
            {lastResult.maxAttemptsReached ? (
              <p className="mt-1">No attempts remain — your department head has been notified.</p>
            ) : (
              <p className="mt-1">{lastResult.attemptsRemaining} attempt(s) remaining.</p>
            )}
          </div>
        )}

        {(!lastResult || (!lastResult.passed && !lastResult.maxAttemptsReached)) && (
          <>
            <div className="mt-4 space-y-4">
              {quiz.questions.map((question, index) => (
                <fieldset key={question.id} className="space-y-1">
                  <legend className="text-sm font-medium text-slate-900">
                    {index + 1}. {question.questionText}
                  </legend>
                  {question.options.map((option, optionIndex) => (
                    <label key={optionIndex} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        checked={answers[question.id] === optionIndex}
                        onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }))}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={!allAnswered || submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </>
        )}

        {lastResult?.maxAttemptsReached && (
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
