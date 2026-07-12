import { WorkflowAction } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { WorkflowStepper } from '../../../components/ui/workflow-stepper';
import { extractErrorMessage } from '../../../lib/api-error';
import { actOnWorkflowStep, fetchWorkflowInstance } from '../../../lib/workflow-api';

export function WorkflowInstancePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: instance, isLoading } = useQuery({
    queryKey: ['workflow-instance', id],
    queryFn: () => fetchWorkflowInstance(id as string),
    enabled: Boolean(id),
  });

  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rejectMutation = useMutation({
    mutationFn: () => actOnWorkflowStep(id as string, { action: WorkflowAction.REJECT, comment: rejectComment }),
    onSuccess: () => {
      setShowRejectForm(false);
      setRejectComment('');
      void queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] });
      void queryClient.invalidateQueries({ queryKey: ['my-pending-tasks'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to reject.'),
  });

  async function handleSign(signingToken: string): Promise<void> {
    await actOnWorkflowStep(id as string, {
      action: WorkflowAction.APPROVE,
      signingToken,
      entitySnapshot: instance ? { entityType: instance.entityType, entityId: instance.entityId } : {},
    });
    setShowSignatureDialog(false);
    void queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] });
    void queryClient.invalidateQueries({ queryKey: ['my-pending-tasks'] });
  }

  if (isLoading || !instance) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const canAct = instance.status === 'in_progress' && instance.currentStep;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">
        {instance.entityType} — {instance.entityId}
      </h1>

      <WorkflowStepper instance={instance} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canAct && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowSignatureDialog(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            Reject
          </button>
        </div>
      )}

      {showRejectForm && (
        <div className="space-y-2 rounded border border-slate-200 p-4">
          <label htmlFor="reject-comment" className="block text-sm font-medium text-slate-700">
            Reason for rejection (required)
          </label>
          <textarea
            id="reject-comment"
            required
            value={rejectComment}
            onChange={(event) => setRejectComment(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRejectForm(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!rejectComment || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirm rejection
            </button>
          </div>
        </div>
      )}

      {showSignatureDialog && instance.currentStep && (
        <SignatureDialog
          meaning={instance.currentStep.signatureMeaning}
          onSign={handleSign}
          onCancel={() => setShowSignatureDialog(false)}
        />
      )}

      {/* PLT-2/PLT-4: workflow actions are audited against the underlying business entity (not
          the WorkflowInstance itself — see WorkflowController.submit/actOnStep), so this is the
          exact same history an approver would see on that entity's own detail page. */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType={instance.entityType} entityId={instance.entityId} />
      </section>
    </div>
  );
}
