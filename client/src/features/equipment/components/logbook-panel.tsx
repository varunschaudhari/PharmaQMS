import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { createLogbookAmendment, fetchLogbook, openLogbookPhoto } from '../../../lib/equipment-api';

const ENTRY_TYPE_LABELS: Record<string, string> = {
  usage_start: 'Usage started',
  usage_stop: 'Usage stopped',
  cleaning: 'Cleaning',
  breakdown: 'Breakdown reported',
  amendment: 'Correction',
};

// EQP-6: read view of the full digital logbook — logging itself happens via the QR-scanned
// mobile card (SPEC.md §7.3 mobile UX); this desktop panel is for QA/audit review.
export function LogbookPanel({ equipmentId }: { equipmentId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [amendingEntryId, setAmendingEntryId] = useState<string | null>(null);
  const [amendmentNote, setAmendmentNote] = useState('');

  const { data: entries } = useQuery({
    queryKey: ['logbook', equipmentId],
    queryFn: () => fetchLogbook(equipmentId),
  });

  const amendMutation = useMutation({
    mutationFn: (description: string) => createLogbookAmendment(equipmentId, amendingEntryId as string, description),
    onSuccess: () => {
      setAmendingEntryId(null);
      setAmendmentNote('');
      void queryClient.invalidateQueries({ queryKey: ['logbook', equipmentId] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to log the correction.'),
  });

  return (
    <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Digital logbook (EQP-6)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!entries || entries.length === 0 ? (
        <p className="text-sm text-slate-500">No logbook entries yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded border border-slate-200 p-2">
              <p className={entry.entryType === 'amendment' ? 'italic text-slate-700' : 'text-slate-800'}>
                <span className="font-medium">{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}</span>
                {' — '}
                {entry.performedByUserFullName} ({entry.occurredAt.slice(0, 16).replace('T', ' ')})
              </p>
              {entry.productBatchRef && <p className="text-xs text-slate-500">Batch/product: {entry.productBatchRef}</p>}
              {entry.cleaningType && <p className="text-xs text-slate-500">Type: {entry.cleaningType}</p>}
              {entry.description && <p className="text-xs text-slate-500">{entry.description}</p>}
              {entry.amendsEntryId && <p className="text-xs text-slate-400">Corrects entry {entry.amendsEntryId}</p>}
              <div className="mt-1 flex gap-2">
                {entry.photoFileName && (
                  <button type="button" onClick={() => void openLogbookPhoto(equipmentId, entry.id)} className="text-xs text-slate-500 underline">
                    View photo
                  </button>
                )}
                {entry.entryType !== 'amendment' && (
                  <button type="button" onClick={() => setAmendingEntryId(entry.id)} className="text-xs text-slate-500 underline">
                    Correct this entry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
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
              <button type="submit" disabled={amendMutation.isPending || !amendmentNote.trim()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                Log correction
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
