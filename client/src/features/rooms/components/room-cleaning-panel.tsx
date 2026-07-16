import { RoomCleaningFrequency } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  createRoomCleaningAmendment,
  fetchRoomCleaningEntries,
  fetchRoomCleaningSchedule,
  upsertRoomCleaningSchedule,
} from '../../../lib/room-api';

const FREQUENCY_LABELS: Record<string, string> = {
  per_shift: 'Per shift',
  daily: 'Daily',
  weekly: 'Weekly',
};

// QRX-1: cleaning schedule + digital cleaning-log history, nested in the room detail page.
// Logging a cleaning entry itself happens via the QR-scanned mobile card (SPEC.md §7.4 mobile
// UX); this desktop panel is for schedule configuration and QA/audit review — same split as
// EQP-4/EQP-6's CalibrationPanel/LogbookPanel.
export function RoomCleaningPanel({ roomId }: { roomId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [amendingEntryId, setAmendingEntryId] = useState<string | null>(null);
  const [amendmentNote, setAmendmentNote] = useState('');

  const { data: schedule } = useQuery({
    queryKey: ['room-cleaning-schedule', roomId],
    queryFn: () => fetchRoomCleaningSchedule(roomId),
  });
  const { data: entries } = useQuery({
    queryKey: ['room-cleaning-entries', roomId],
    queryFn: () => fetchRoomCleaningEntries(roomId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['room-cleaning-schedule', roomId] });
    void queryClient.invalidateQueries({ queryKey: ['room-cleaning-entries', roomId] });
    void queryClient.invalidateQueries({ queryKey: ['room-status-card', roomId] });
    void queryClient.invalidateQueries({ queryKey: ['audit-history', 'Room', roomId] });
  }

  const scheduleMutation = useMutation({
    mutationFn: (input: { routineFrequency: RoomCleaningFrequency; fullCleaningIntervalDays: number; nextRoutineDueDate: string; nextFullDueDate: string }) =>
      upsertRoomCleaningSchedule(roomId, input),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to save cleaning schedule.'),
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

  function handleScheduleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    scheduleMutation.mutate({
      routineFrequency: form.get('routineFrequency') as RoomCleaningFrequency,
      fullCleaningIntervalDays: Number(form.get('fullCleaningIntervalDays')),
      nextRoutineDueDate: String(form.get('nextRoutineDueDate') ?? ''),
      nextFullDueDate: String(form.get('nextFullDueDate') ?? ''),
    });
  }

  return (
    <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Cleaning schedule &amp; log (QRX-1)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Schedule</h3>
        {schedule ? (
          <p className="mt-1 text-sm text-slate-700">
            Routine: {FREQUENCY_LABELS[schedule.routineFrequency] ?? schedule.routineFrequency} (next due{' '}
            {schedule.nextRoutineDueDate.slice(0, 10)}). Full clean every {schedule.fullCleaningIntervalDays} day(s) (next due{' '}
            {schedule.nextFullDueDate.slice(0, 10)}).
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No cleaning schedule configured yet.</p>
        )}

        <form onSubmit={handleScheduleSubmit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <select name="routineFrequency" defaultValue={schedule?.routineFrequency ?? RoomCleaningFrequency.DAILY} className="rounded border border-slate-300 px-2 py-1">
            <option value={RoomCleaningFrequency.PER_SHIFT}>Per shift</option>
            <option value={RoomCleaningFrequency.DAILY}>Daily</option>
            <option value={RoomCleaningFrequency.WEEKLY}>Weekly</option>
          </select>
          <input
            name="fullCleaningIntervalDays"
            type="number"
            min={1}
            placeholder="Full-clean interval (days)"
            required
            defaultValue={schedule?.fullCleaningIntervalDays}
            className="rounded border border-slate-300 px-2 py-1"
          />
          <div>
            <label htmlFor="next-routine-due" className="block text-xs text-slate-500">
              Next routine due
            </label>
            <input
              id="next-routine-due"
              name="nextRoutineDueDate"
              type="date"
              required
              defaultValue={schedule?.nextRoutineDueDate.slice(0, 10)}
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor="next-full-due" className="block text-xs text-slate-500">
              Next full clean due
            </label>
            <input
              id="next-full-due"
              name="nextFullDueDate"
              type="date"
              required
              defaultValue={schedule?.nextFullDueDate.slice(0, 10)}
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          </div>
          <button type="submit" disabled={scheduleMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
            {schedule ? 'Update schedule' : 'Create schedule'}
          </button>
        </form>
      </div>

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Cleaning log</h3>
        {!entries || entries.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No cleaning entries yet — logged from the QR scan view.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded border border-slate-200 p-2">
                <p className={entry.entryType === 'amendment' ? 'italic text-slate-700' : 'text-slate-800'}>
                  <span className="font-medium">
                    {entry.entryType === 'amendment' ? 'Correction' : entry.cleaningType === 'full' ? 'Full clean' : 'Routine clean'}
                  </span>
                  {' — '}
                  {entry.performedByUserFullName} ({entry.occurredAt.slice(0, 16).replace('T', ' ')})
                </p>
                {entry.remarks && <p className="text-xs text-slate-500">{entry.remarks}</p>}
                {entry.amendsEntryId && <p className="text-xs text-slate-400">Corrects entry {entry.amendsEntryId}</p>}
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
    </section>
  );
}
