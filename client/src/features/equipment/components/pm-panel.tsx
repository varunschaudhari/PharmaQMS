import { SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { useAuth } from '../../auth/context/auth-context';
import { extractErrorMessage } from '../../../lib/api-error';
import { completePmTask, fetchPmPlan, fetchPmTasksForEquipment, upsertPmPlan } from '../../../lib/equipment-api';

const EDIT_PERMISSION = 'equipment:edit';

// EQP-9: preventive-maintenance plan + tasks for this equipment. Completion is a single-step
// e-signature (unlike EQP-7's separate engineer-completion + configurable QA-verification).
export function PmPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionStep, setCompletionStep] = useState<'note' | 'sign'>('note');

  const canEdit = user?.permissions.includes(EDIT_PERMISSION) ?? false;

  const { data: plan } = useQuery({ queryKey: ['pm-plan', equipmentId], queryFn: () => fetchPmPlan(equipmentId) });
  const { data: tasks } = useQuery({ queryKey: ['pm-tasks', equipmentId], queryFn: () => fetchPmTasksForEquipment(equipmentId) });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['pm-plan', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['pm-tasks', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['equipment-status-card', equipmentId] });
  }

  const planMutation = useMutation({
    mutationFn: (input: { frequencyMonths: number; checklistText: string; nextDueDate: string }) => upsertPmPlan(equipmentId, input),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to save PM plan.'),
  });

  const completeMutation = useMutation({
    mutationFn: (signingToken: string) => completePmTask(completingTaskId as string, signingToken, completionNote),
    onSuccess: () => {
      closeCompletionDialog();
      invalidate();
    },
    onError: (err) => {
      closeCompletionDialog();
      setError(extractErrorMessage(err) ?? 'Failed to complete PM task.');
    },
  });

  function closeCompletionDialog(): void {
    setCompletingTaskId(null);
    setCompletionStep('note');
    setCompletionNote('');
  }

  function handlePlanSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    planMutation.mutate({
      frequencyMonths: Number(form.get('frequencyMonths')),
      checklistText: String(form.get('checklistText') ?? ''),
      nextDueDate: String(form.get('nextDueDate') ?? ''),
    });
  }

  return (
    <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Preventive Maintenance (EQP-9)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Plan</h3>
        {plan ? (
          <p className="mt-1 text-sm text-slate-700">
            Every {plan.frequencyMonths} month(s) — {plan.checklistText}. Next due {plan.nextDueDate.slice(0, 10)}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No PM plan configured yet.</p>
        )}

        {canEdit && (
          <form onSubmit={handlePlanSubmit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <input name="frequencyMonths" type="number" min={1} placeholder="Frequency (months)" required defaultValue={plan?.frequencyMonths} className="rounded border border-slate-300 px-2 py-1" />
            <input name="nextDueDate" aria-label="Next due date" type="date" required defaultValue={plan?.nextDueDate.slice(0, 10)} className="rounded border border-slate-300 px-2 py-1" />
            <textarea name="checklistText" placeholder="Checklist (what to check)" required defaultValue={plan?.checklistText} rows={2} className="col-span-2 rounded border border-slate-300 px-2 py-1" />
            <button type="submit" disabled={planMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
              {plan ? 'Update plan' : 'Create plan'}
            </button>
          </form>
        )}
      </div>

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Tasks</h3>
        {!tasks || tasks.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No PM tasks yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="rounded border border-slate-200 p-2">
                <p>
                  Due {task.dueDate.slice(0, 10)} — <span className="font-medium">{task.status === 'open' ? 'Open' : 'Completed'}</span>
                </p>
                {task.completionNote && <p className="text-xs text-slate-500">{task.completionNote}</p>}
                {canEdit && task.status === 'open' && (
                  <button type="button" onClick={() => setCompletingTaskId(task.id)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs">
                    Complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {completingTaskId && completionStep === 'note' && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">Complete PM task</h2>
            <textarea
              value={completionNote}
              onChange={(event) => setCompletionNote(event.target.value)}
              rows={3}
              placeholder="Completion note (required)"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeCompletionDialog} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={!completionNote.trim()}
                onClick={() => setCompletionStep('sign')}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Continue to sign
              </button>
            </div>
          </div>
        </div>
      )}
      {completingTaskId && completionStep === 'sign' && (
        <SignatureDialog meaning={SignatureMeaning.PM_COMPLETED} onSign={(token) => completeMutation.mutateAsync(token)} onCancel={closeCompletionDialog} />
      )}
    </section>
  );
}
