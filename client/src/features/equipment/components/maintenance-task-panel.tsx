import { SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { useAuth } from '../../auth/context/auth-context';
import { extractErrorMessage } from '../../../lib/api-error';
import { closeMaintenanceTask, fetchMaintenanceTasksForEquipment, verifyMaintenanceTask } from '../../../lib/equipment-api';

const EDIT_PERMISSION = 'equipment:edit';
const APPROVE_PERMISSION = 'equipment:approve';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending_verification: 'Pending Verification',
  closed: 'Closed',
};

// EQP-7: maintenance tasks auto-created from breakdown reports, scoped to this equipment.
export function MaintenanceTaskPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [closingTaskId, setClosingTaskId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null);

  const canEdit = user?.permissions.includes(EDIT_PERMISSION) ?? false;
  const canApprove = user?.permissions.includes(APPROVE_PERMISSION) ?? false;

  const { data: tasks } = useQuery({
    queryKey: ['maintenance-tasks', equipmentId],
    queryFn: () => fetchMaintenanceTasksForEquipment(equipmentId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['maintenance-tasks', equipmentId] });
  }

  const closeMutation = useMutation({
    mutationFn: () => closeMaintenanceTask(closingTaskId as string, completionNote),
    onSuccess: () => {
      setClosingTaskId(null);
      setCompletionNote('');
      invalidate();
    },
    onError: (err) => {
      setClosingTaskId(null);
      setError(extractErrorMessage(err) ?? 'Failed to close the maintenance task.');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (signingToken: string) => verifyMaintenanceTask(verifyingTaskId as string, signingToken),
    onSuccess: () => {
      setVerifyingTaskId(null);
      invalidate();
    },
    onError: (err) => {
      setVerifyingTaskId(null);
      setError(extractErrorMessage(err) ?? 'Failed to verify the maintenance task.');
    },
  });

  function handleCloseSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    closeMutation.mutate();
  }

  return (
    <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Maintenance tasks (EQP-7)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!tasks || tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No maintenance tasks yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {tasks.map((task) => (
            <li key={task.id} className="rounded border border-slate-200 p-2">
              <p>
                <span className="font-medium">{STATUS_LABELS[task.status]}</span> — created {task.createdAt.slice(0, 10)}
              </p>
              {task.engineerCompletionNote && <p className="text-xs text-slate-500">Engineer note: {task.engineerCompletionNote}</p>}
              {task.verificationNote && <p className="text-xs text-slate-500">Verification note: {task.verificationNote}</p>}
              {canEdit && task.status === 'open' && (
                <button type="button" onClick={() => setClosingTaskId(task.id)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  Close (completion note)
                </button>
              )}
              {canApprove && task.status === 'pending_verification' && (
                <button type="button" onClick={() => setVerifyingTaskId(task.id)} className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  Verify
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {closingTaskId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <form onSubmit={handleCloseSubmit} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">Close maintenance task</h2>
            <textarea
              value={completionNote}
              onChange={(event) => setCompletionNote(event.target.value)}
              required
              rows={3}
              placeholder="Completion note (required)"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setClosingTaskId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={closeMutation.isPending || !completionNote.trim()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                Close task
              </button>
            </div>
          </form>
        </div>
      )}

      {verifyingTaskId && (
        <SignatureDialog
          meaning={SignatureMeaning.VERIFIED_BY}
          onSign={async (token) => {
            await verifyMutation.mutateAsync(token);
          }}
          onCancel={() => setVerifyingTaskId(null)}
        />
      )}
    </section>
  );
}
