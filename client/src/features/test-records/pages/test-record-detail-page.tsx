import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { SignatureManifest } from '../../../components/ui/signature-manifest';
import { WorkflowStepper } from '../../../components/ui/workflow-stepper';
import { extractErrorMessage } from '../../../lib/api-error';
import { fetchSignatures } from '../../../lib/esign-api';
import { downloadQrLabel, fetchTestRecord, updateTestRecord } from '../../../lib/test-record-api';
import { submitWorkflow } from '../../../lib/workflow-api';

// Phase 0 gate demo detail page: every platform surface on one screen — metadata + audited
// edits, workflow stepper + submit, signature manifest, QR block, and the mandatory HistoryTab.
export function TestRecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);

  const { data: record, isLoading } = useQuery({
    queryKey: ['test-record', id],
    queryFn: () => fetchTestRecord(id as string),
    enabled: Boolean(id),
  });

  const { data: signatures } = useQuery({
    queryKey: ['signatures', 'TestRecord', id],
    queryFn: () => fetchSignatures('TestRecord', id as string),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['test-record', id] });
    void queryClient.invalidateQueries({ queryKey: ['audit-history', 'TestRecord', id] });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitWorkflow({ entityType: 'TestRecord', entityId: id as string }),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to submit.'),
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) => updateTestRecord(id as string, { title }),
    onSuccess: () => {
      setEditTitle(null);
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to update.'),
  });

  if (isLoading || !record) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const canSubmit = !record.workflow || record.workflow.status === 'draft';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Test record</p>
          <h1 className="text-lg font-semibold text-slate-900">
            {record.recordNumber} — {record.title}
          </h1>
          <p className="text-sm text-slate-600">{record.description}</p>
        </div>
        {canSubmit ? (
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Submit for approval
          </button>
        ) : (
          record.workflow &&
          record.workflow.status === 'in_progress' && (
            <Link to={`/workflow/instances/${record.workflow.id}`} className="text-sm text-slate-600 underline">
              Open approval task
            </Link>
          )
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Edit (audited)</h2>
        {editTitle === null ? (
          <button type="button" onClick={() => setEditTitle(record.title)} className="mt-2 text-sm text-slate-600 underline">
            Rename record
          </button>
        ) : (
          <div className="mt-2 flex gap-2">
            <input
              aria-label="New title"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => renameMutation.mutate(editTitle)}
              disabled={!editTitle || renameMutation.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}
      </section>

      {record.workflow && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Approval workflow</h2>
          <WorkflowStepper instance={record.workflow} />
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Signatures</h2>
        <SignatureManifest signatures={signatures ?? []} />
      </section>

      {record.qr && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">QR label</h2>
          <p className="mt-1 text-sm text-slate-600">
            Code <span className="font-mono">{record.qr.code}</span> —{' '}
            <Link to={`/s/${record.qr.code}`} className="underline">
              open mobile view
            </Link>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void downloadQrLabel(record.qr!.code, 'single')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Single label PDF
            </button>
            <button
              type="button"
              onClick={() => void downloadQrLabel(record.qr!.code, 'a4')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              A4 sheet PDF
            </button>
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="TestRecord" entityId={record.id} />
      </section>
    </div>
  );
}
