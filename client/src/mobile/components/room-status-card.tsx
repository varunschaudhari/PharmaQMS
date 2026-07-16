import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { extractErrorMessage } from '../../lib/api-error';
import { createRoomCleaningAmendment, fetchRoomStatusCard, logRoomCleaning } from '../../lib/room-api';

// QRX-1: reuses EQP-4's calibration status palette — deriveRoomCleaningStatus maps onto the same
// CalibrationStatus enum values (see packages/shared/src/room-status.ts), so no new labels needed.
const CLEANING_STYLES: Record<string, { label: string; className: string }> = {
  valid: { label: 'CLEAN', className: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  due_soon: { label: 'DUE SOON', className: 'bg-amber-100 text-amber-700 border-amber-300' },
  overdue: { label: 'OVERDUE', className: 'bg-red-100 text-red-700 border-red-300' },
  not_scheduled: { label: 'NOT SCHEDULED', className: 'bg-slate-100 text-slate-500 border-slate-300' },
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  retired: 'Retired',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  general: 'General',
  controlled: 'Controlled',
};

type ActiveForm = 'cleaning' | null;

// QRX-1: the scan-to-status-card view (SPEC.md §7.4) — mirrors EQP-3/EQP-6's EquipmentStatusCard,
// narrowed to cleaning status only. Logging a cleaning entry needs only authentication (the scan
// itself is the access control, same as EQP-6's logbook).
export function RoomStatusCard({ roomId }: { roomId: string }) {
  const queryClient = useQueryClient();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [amendingEntryId, setAmendingEntryId] = useState<string | null>(null);
  const [amendmentNote, setAmendmentNote] = useState('');

  const { data: card, isLoading } = useQuery({
    queryKey: ['room-status-card', roomId],
    queryFn: () => fetchRoomStatusCard(roomId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['room-status-card', roomId] });
  }

  const cleaningMutation = useMutation({
    mutationFn: (input: { cleaningType: 'routine' | 'full'; remarks?: string }) =>
      logRoomCleaning(roomId, input.cleaningType as never, input.remarks),
    onSuccess: () => {
      setActiveForm(null);
      setRemarks('');
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to log cleaning.'),
  });

  const amendMutation = useMutation({
    mutationFn: (description: string) => createRoomCleaningAmendment(roomId, amendingEntryId as string, description),
    onSuccess: () => {
      setAmendingEntryId(null);
      setAmendmentNote('');
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to log the correction.'),
  });

  if (isLoading || !card) {
    return <p className="text-sm text-slate-500">Loading status…</p>;
  }

  const cleaning = CLEANING_STYLES[card.cleaningStatus];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-400">{card.roomCode}</p>
        <h1 className="text-lg font-semibold text-slate-900">{card.name}</h1>
        <p className="text-sm text-slate-600">
          {card.block ? `${card.block} — ` : ''}
          {CLASSIFICATION_LABELS[card.classification] ?? card.classification}
        </p>
        <p className="mt-2 text-sm">
          Current status: <span className="font-medium">{STATUS_LABELS[card.status]}</span>
        </p>
      </div>

      <div className={`rounded-lg border p-3 text-center ${cleaning.className}`}>
        <p className="text-xs font-medium uppercase tracking-wide">Cleaning status</p>
        <p className="text-xl font-bold">{cleaning.label}</p>
        {card.lastCleaningEntry && (
          <p className="text-xs">
            Last cleaned {card.lastCleaningEntry.occurredAt.slice(0, 16).replace('T', ' ')} by {card.lastCleaningEntry.performedByUserFullName}
          </p>
        )}
        {card.nextRoutineDueDate && <p className="text-xs">Next routine due {card.nextRoutineDueDate.slice(0, 10)}</p>}
        {card.nextFullDueDate && <p className="text-xs">Next full clean due {card.nextFullDueDate.slice(0, 10)}</p>}
      </div>

      {card.status === 'retired' && (
        <div className="rounded-lg border border-slate-400 bg-slate-100 p-3 text-center text-sm font-semibold text-slate-700">
          This room is Retired — no further cleaning entries may be logged.
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded border border-slate-200 bg-white p-3">
        <p className="text-xs uppercase text-slate-400">Recent cleaning entries</p>
        {card.recentCleaningEntries.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No cleaning entries yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            {card.recentCleaningEntries.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <p className={entry.entryType === 'amendment' ? 'italic' : undefined}>
                  <span className="font-medium text-slate-800">
                    {entry.entryType === 'amendment' ? 'Correction' : entry.cleaningType === 'full' ? 'Full clean' : 'Routine clean'}
                  </span>
                  {' — '}
                  {entry.performedByUserFullName} ({entry.occurredAt.slice(0, 16).replace('T', ' ')})
                </p>
                {entry.remarks && <p className="text-xs text-slate-500">{entry.remarks}</p>}
                {entry.entryType !== 'amendment' && (
                  <button type="button" onClick={() => setAmendingEntryId(entry.id)} className="mt-1 text-xs text-slate-500 underline">
                    Correct this entry
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {card.availableActions.includes('log_cleaning') && (
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setActiveForm('cleaning');
            }}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
          >
            Log Cleaning
          </button>
        </div>
      )}

      {activeForm === 'cleaning' && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Log cleaning</p>
          <textarea
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={2}
            placeholder="Remarks (optional)"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cleaningMutation.isPending}
              onClick={() => cleaningMutation.mutate({ cleaningType: 'routine', remarks: remarks.trim() || undefined })}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Routine
            </button>
            <button
              type="button"
              disabled={cleaningMutation.isPending}
              onClick={() => cleaningMutation.mutate({ cleaningType: 'full', remarks: remarks.trim() || undefined })}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Full
            </button>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setActiveForm(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {amendingEntryId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              amendMutation.mutate(amendmentNote);
            }}
            className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg"
          >
            <h2 className="text-base font-semibold text-slate-900">Correct this entry</h2>
            <p className="text-xs text-slate-500">The original entry is never edited — this logs a new correction note alongside it.</p>
            <textarea
              value={amendmentNote}
              onChange={(event) => setAmendmentNote(event.target.value)}
              required
              rows={3}
              placeholder="What was wrong, and what is the correction?"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAmendingEntryId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={amendMutation.isPending || !amendmentNote.trim()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Log correction
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
