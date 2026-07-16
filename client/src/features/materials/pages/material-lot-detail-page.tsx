import { MATERIAL_LOT_STATUS_TRANSITIONS, MaterialLotStatus, SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { extractErrorMessage } from '../../../lib/api-error';
import { dispositionMaterialLotStatus, downloadMaterialLotLabel, fetchMaterialLot } from '../../../lib/material-lot-api';
import { useAuth } from '../../auth/context/auth-context';

const STATUS_LABELS: Record<string, string> = {
  quarantine: 'Quarantine',
  under_test: 'Under Test',
  approved: 'Approved',
  rejected: 'Rejected',
};

const APPROVE_PERMISSION = 'materials:approve';

type DispositionStep = { toStatus: MaterialLotStatus; phase: 'note' | 'sign' } | null;

// QRX-2: material lot detail — metadata, QR label downloads, QA-only e-signed status change
// (explicit transition map, never a direct field write), and the mandatory HistoryTab.
export function MaterialLotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [disposition, setDisposition] = useState<DispositionStep>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canApprove = user?.permissions.includes(APPROVE_PERMISSION) ?? false;

  const { data: lot, isLoading } = useQuery({
    queryKey: ['material-lot', id],
    queryFn: () => fetchMaterialLot(id as string),
    enabled: Boolean(id),
  });

  function closeDisposition(): void {
    setDisposition(null);
    setNote('');
  }

  const dispositionMutation = useMutation({
    mutationFn: (signingToken: string) => dispositionMaterialLotStatus(id as string, signingToken, disposition!.toStatus, note || undefined),
    onSuccess: () => {
      closeDisposition();
      void queryClient.invalidateQueries({ queryKey: ['material-lot', id] });
      void queryClient.invalidateQueries({ queryKey: ['audit-history', 'MaterialLot', id] });
    },
    onError: (err) => {
      closeDisposition();
      setError(extractErrorMessage(err) ?? 'Failed to change status.');
    },
  });

  if (isLoading || !lot) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const allowedTransitions = MATERIAL_LOT_STATUS_TRANSITIONS[lot.status] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {lot.lotCode} — {STATUS_LABELS[lot.status]}
          </p>
          <h1 className="text-lg font-semibold text-slate-900">{lot.materialName}</h1>
          <p className="text-sm text-slate-600">
            {lot.manufacturer ? `${lot.manufacturer} — ` : ''}
            Received {lot.receivedDate.slice(0, 10)}
          </p>
        </div>
        {lot.qr && (
          <div className="flex gap-2">
            <button type="button" onClick={() => void downloadMaterialLotLabel(lot.qr!.code, 'single')} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Single label PDF
            </button>
            <button type="button" onClick={() => void downloadMaterialLotLabel(lot.qr!.code, 'a4')} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              A4 sheet PDF
            </button>
            <Link to={`/s/${lot.qr.code}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Open mobile view
            </Link>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canApprove && allowedTransitions.length > 0 && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">QA Disposition</h2>
          <p className="mt-1 text-xs text-slate-500">A status change is an e-signature — a valid session alone is not sufficient.</p>
          <div className="mt-2 flex gap-2">
            {allowedTransitions.map((toStatus) => (
              <button
                key={toStatus}
                type="button"
                onClick={() => {
                  setError(null);
                  setDisposition({ toStatus, phase: 'note' });
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm"
              >
                Move to {STATUS_LABELS[toStatus]}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="MaterialLot" entityId={lot.id} />
      </section>

      {disposition?.phase === 'note' && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">QA Disposition — {STATUS_LABELS[disposition.toStatus]}</h2>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Disposition note (optional)"
              rows={3}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeDisposition} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setDisposition({ toStatus: disposition.toStatus, phase: 'sign' })}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Continue to sign
              </button>
            </div>
          </div>
        </div>
      )}
      {disposition?.phase === 'sign' && (
        <SignatureDialog
          meaning={SignatureMeaning.QA_DISPOSITION}
          onSign={async (token) => {
            await dispositionMutation.mutateAsync(token);
          }}
          onCancel={closeDisposition}
        />
      )}
    </div>
  );
}
