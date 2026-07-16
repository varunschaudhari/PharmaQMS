import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  approveTrainingAssessment,
  fetchTrainingAssessmentForAuthoring,
  upsertTrainingAssessment,
} from '../../../lib/training-assessment-api';
import { useAuth } from '../../auth/context/auth-context';

const EDIT_PERMISSION = 'training:edit';
const APPROVE_PERMISSION = 'training:approve';

interface DraftQuestion {
  questionText: string;
  options: string[];
  correctOptionIndex: number;
}

function blankQuestion(): DraftQuestion {
  return { questionText: '', options: ['', ''], correctOptionIndex: 0 };
}

// TRN-6 (a): QA authors/edits the MCQ question bank for one document version, and separately
// approves it (the explicit QA review step) before trainees can be quizzed on it. Editing an
// Approved assessment resets it to Draft server-side — the UI reflects that on the next save.
export function TrainingAssessmentPanel({
  documentId,
  versionId,
  versionLabel,
  docNumber,
}: {
  documentId: string;
  versionId: string;
  versionLabel: string;
  docNumber: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canEdit = user?.permissions.includes(EDIT_PERMISSION) ?? false;
  const canApprove = user?.permissions.includes(APPROVE_PERMISSION) ?? false;

  const { data: assessment } = useQuery({
    queryKey: ['training-assessment-authoring', documentId, versionId],
    queryFn: () => fetchTrainingAssessmentForAuthoring(documentId, versionId),
  });

  useEffect(() => {
    if (assessment) {
      setQuestions(assessment.questions.map((q) => ({ questionText: q.questionText, options: q.options, correctOptionIndex: q.correctOptionIndex })));
    }
  }, [assessment]);

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['training-assessment-authoring', documentId, versionId] });
  }

  const saveMutation = useMutation({
    mutationFn: () => upsertTrainingAssessment(documentId, versionId, { docNumber, versionLabel, questions }),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to save the assessment.'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveTrainingAssessment(documentId, versionId),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to approve the assessment.'),
  });

  if (!canEdit && !assessment) {
    return null; // Nothing configured, and this viewer can't author one — no empty panel to show.
  }

  function updateQuestion(index: number, patch: Partial<DraftQuestion>): void {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function updateOption(questionIndex: number, optionIndex: number, value: string): void {
    setQuestions((prev) =>
      prev.map((q, i) => (i === questionIndex ? { ...q, options: q.options.map((o, oi) => (oi === optionIndex ? value : o)) } : q)),
    );
  }

  function addOption(questionIndex: number): void {
    setQuestions((prev) => prev.map((q, i) => (i === questionIndex && q.options.length < 6 ? { ...q, options: [...q.options, ''] } : q)));
  }

  function removeOption(questionIndex: number, optionIndex: number): void {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== questionIndex || q.options.length <= 2) return q;
        const options = q.options.filter((_, oi) => oi !== optionIndex);
        const correctOptionIndex = q.correctOptionIndex >= options.length ? 0 : q.correctOptionIndex;
        return { ...q, options, correctOptionIndex };
      }),
    );
  }

  return (
    <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Assessment (TRN-6) — v{versionLabel}</h2>
        {assessment && (
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${assessment.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {assessment.status === 'approved' ? 'Approved' : 'Draft'}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {canEdit && (
        <div className="space-y-3">
          {questions.map((question, qIndex) => (
            <div key={qIndex} className="rounded border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <input
                  aria-label={`Question ${qIndex + 1} text`}
                  placeholder={`Question ${qIndex + 1}`}
                  value={question.questionText}
                  onChange={(event) => updateQuestion(qIndex, { questionText: event.target.value })}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIndex))} className="text-xs text-red-600 underline">
                  Remove
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {question.options.map((option, oIndex) => (
                  <div key={oIndex} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      aria-label={`Option ${oIndex + 1} is correct`}
                      checked={question.correctOptionIndex === oIndex}
                      onChange={() => updateQuestion(qIndex, { correctOptionIndex: oIndex })}
                    />
                    <input
                      aria-label={`Question ${qIndex + 1} option ${oIndex + 1}`}
                      placeholder={`Option ${oIndex + 1}`}
                      value={option}
                      onChange={(event) => updateOption(qIndex, oIndex, event.target.value)}
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                    {question.options.length > 2 && (
                      <button type="button" onClick={() => removeOption(qIndex, oIndex)} className="text-xs text-slate-400 underline">
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {question.options.length < 6 && (
                  <button type="button" onClick={() => addOption(qIndex)} className="text-xs text-slate-600 underline">
                    Add option
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setQuestions((prev) => [...prev, blankQuestion()])} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Add question
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending || questions.length === 0}
              onClick={() => saveMutation.mutate()}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Save question bank
            </button>
            {canApprove && assessment && assessment.status === 'draft' && (
              <button
                type="button"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
                className="rounded border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 disabled:opacity-50"
              >
                Approve for trainees
              </button>
            )}
          </div>
        </div>
      )}

      {!canEdit && assessment && (
        <p className="text-sm text-slate-600">{assessment.questions.length} question(s) configured — {assessment.status}.</p>
      )}
    </section>
  );
}
