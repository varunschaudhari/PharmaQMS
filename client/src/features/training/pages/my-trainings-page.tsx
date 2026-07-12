import { SignatureMeaning } from '@pharmaqms/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { extractErrorMessage } from '../../../lib/api-error';
import { completeTrainingAssignment, fetchMyTrainingAssignments } from '../../../lib/training-api';

// TRN-2: read-and-understood flow, mobile-first (SPEC §7.2 "works on mobile") — narrow card
// layout rather than a wide table so it renders equally well on a phone or the desktop shell.
export function MyTrainingsPage() {
  const queryClient = useQueryClient();
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['my-trainings'],
    queryFn: fetchMyTrainingAssignments,
  });

  const [error, setError] = useState<string | null>(null);
  const [signingAssignmentId, setSigningAssignmentId] = useState<string | null>(null);

  async function handleSign(signingToken: string): Promise<void> {
    if (!signingAssignmentId) return;
    try {
      await completeTrainingAssignment(signingAssignmentId, signingToken);
      setSigningAssignmentId(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['my-trainings'] });
    } catch (err) {
      setSigningAssignmentId(null);
      setError(extractErrorMessage(err) ?? 'Failed to complete training.');
    }
  }

  const pending = (assignments ?? []).filter((a) => a.status === 'pending');
  const completed = (assignments ?? []).filter((a) => a.status === 'completed');

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">My Trainings</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing pending — you&apos;re up to date.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((assignment) => (
            <li
              key={assignment.id}
              className={`rounded-lg border p-4 shadow-sm ${
                assignment.isOverdue ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-slate-400">{assignment.docNumber}</p>
              <p className="font-medium text-slate-900">{assignment.documentTitle}</p>
              <p className="text-sm text-slate-600">Version {assignment.versionLabel}</p>
              {assignment.dueDate && (
                <p className={`mt-1 text-xs ${assignment.isOverdue ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                  {assignment.isOverdue ? 'Overdue' : 'Due'} {assignment.dueDate.slice(0, 10)}
                </p>
              )}
              <button
                type="button"
                onClick={() => setSigningAssignmentId(assignment.id)}
                className="mt-3 w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              >
                I have read and understood this document
              </button>
            </li>
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <details className="rounded border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Completed ({completed.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {completed.map((assignment) => (
              <li key={assignment.id}>
                {assignment.docNumber} v{assignment.versionLabel} — {assignment.completedAt?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {signingAssignmentId && (
        <SignatureDialog
          meaning={SignatureMeaning.TRAINED_READ_AND_UNDERSTOOD}
          onSign={handleSign}
          onCancel={() => setSigningAssignmentId(null)}
        />
      )}
    </div>
  );
}
