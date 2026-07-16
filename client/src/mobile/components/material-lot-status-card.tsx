import { MATERIAL_LOT_STATUS_TRANSITIONS, MaterialLotStatus, SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SignatureDialog } from '../../components/ui/signature-dialog';
import { extractErrorMessage } from '../../lib/api-error';
import { dispositionMaterialLotStatus, fetchMaterialLotScanView } from '../../lib/material-lot-api';

// QRX-2: large color-coded status banner (SPEC.md §7.4) — green Approved, amber Quarantine/Under
// Test, red Rejected. Reuses no shared enum for styling (this is presentation-only, same as
// EQP-3/QRX-1's own STYLES maps).
const STATUS_STYLES: Record<MaterialLotStatus, { label: string; className: string }> = {
  [MaterialLotStatus.QUARANTINE]: { label: 'QUARANTINE', className: 'bg-amber-100 text-amber-700 border-amber-300' },
  [MaterialLotStatus.UNDER_TEST]: { label: 'UNDER TEST', className: 'bg-amber-100 text-amber-700 border-amber-300' },
  [MaterialLotStatus.APPROVED]: { label: 'APPROVED', className: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  [MaterialLotStatus.REJECTED]: { label: 'REJECTED', className: 'bg-red-100 text-red-700 border-red-300' },
};

const STATUS_LABELS: Record<string, string> = {
  quarantine: 'Quarantine',
  under_test: 'Under Test',
  approved: 'Approved',
  rejected: 'Rejected',
};

type DispositionStep = { toStatus: MaterialLotStatus; phase: 'note' | 'sign' } | null;

// QRX-2: the scan-to-status view (SPEC.md §7.4, Non-Goals §3 — status verification only, no
// quantities/movement). View-only for non-QA roles; QA sees status-change buttons (one per allowed
// transition) gated behind a note-then-signature two-step, same pattern as EQP-5's calibration
// disposition — never both the note form and the signature dialog at once.
export function MaterialLotStatusCard({ lotId }: { lotId: string }) {
  const queryClient = useQueryClient();
  const [disposition, setDisposition] = useState<DispositionStep>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: card, isLoading } = useQuery({
    queryKey: ['material-lot-scan-view', lotId],
    queryFn: () => fetchMaterialLotScanView(lotId),
  });

  function closeDisposition(): void {
    setDisposition(null);
    setNote('');
  }

  const dispositionMutation = useMutation({
    mutationFn: (signingToken: string) => dispositionMaterialLotStatus(lotId, signingToken, disposition!.toStatus, note || undefined),
    onSuccess: () => {
      closeDisposition();
      void queryClient.invalidateQueries({ queryKey: ['material-lot-scan-view', lotId] });
    },
    onError: (err) => {
      closeDisposition();
      setError(extractErrorMessage(err) ?? 'Failed to change status.');
    },
  });

  if (isLoading || !card) {
    return <p className="text-sm text-slate-500">Loading status…</p>;
  }

  const style = STATUS_STYLES[card.status];
  const allowedTransitions = MATERIAL_LOT_STATUS_TRANSITIONS[card.status] ?? [];
  const canChangeStatus = card.availableActions.includes('change_status');

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border-2 p-6 text-center shadow-sm ${style.className}`}>
        <p className="text-4xl font-bold">{style.label}</p>
        <p className="mt-2 text-sm font-medium">{card.lotCode}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{card.materialName}</h1>
        {card.manufacturer && <p className="text-sm text-slate-600">{card.manufacturer}</p>}
        <p className="text-sm text-slate-600">Received {card.receivedDate.slice(0, 10)}</p>
      </div>

      <div className="rounded border border-slate-200 bg-white p-3">
        <p className="text-xs uppercase text-slate-400">Disposition</p>
        {card.lastDisposition ? (
          <p className="mt-1 text-sm text-slate-700">
            {card.lastDisposition.userFullName} — {card.lastDisposition.signedAt.slice(0, 16).replace('T', ' ')}
            {card.lastDisposition.reason && <span className="block text-xs text-slate-500">{card.lastDisposition.reason}</span>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No QA disposition recorded yet.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canChangeStatus && allowedTransitions.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {allowedTransitions.map((toStatus) => (
            <button
              key={toStatus}
              type="button"
              onClick={() => {
                setError(null);
                setDisposition({ toStatus, phase: 'note' });
              }}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            >
              Move to {STATUS_LABELS[toStatus] ?? toStatus}
            </button>
          ))}
        </div>
      )}

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
