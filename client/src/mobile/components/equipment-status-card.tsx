import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../lib/api-error';
import {
  createLogbookAmendment,
  fetchEquipmentStatusCard,
  logBreakdown,
  logCleaning,
  logUsageStart,
  logUsageStop,
  openLogbookPhoto,
} from '../../lib/equipment-api';

const CALIBRATION_STYLES: Record<string, { label: string; className: string }> = {
  valid: { label: 'VALID', className: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  due_soon: { label: 'DUE SOON', className: 'bg-amber-100 text-amber-700 border-amber-300' },
  overdue: { label: 'OVERDUE', className: 'bg-red-100 text-red-700 border-red-300' },
  not_scheduled: { label: 'NOT SCHEDULED', className: 'bg-slate-100 text-slate-500 border-slate-300' },
};

// EQP-8: same shape as CALIBRATION_STYLES but its own labels (qualified/not qualified rather
// than valid/not scheduled) — the underlying enum values differ (QualificationStatus).
const QUALIFICATION_STYLES: Record<string, { label: string; className: string }> = {
  qualified: { label: 'Qualified', className: 'text-emerald-700' },
  due_soon: { label: 'Due soon', className: 'text-amber-700' },
  overdue: { label: 'Overdue', className: 'text-red-700 font-semibold' },
  not_qualified: { label: 'Not qualified', className: 'text-slate-500' },
};

// EQP-9: PM status reuses CalibrationStatus's own values/labels (VALID/DUE_SOON/OVERDUE/
// NOT_SCHEDULED) — no separate enum, so CALIBRATION_STYLES is reused directly for PM too.
const PM_STYLES = CALIBRATION_STYLES;

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  under_maintenance: 'Under Maintenance',
  under_qualification: 'Under Qualification',
  do_not_use: 'Do Not Use',
  retired: 'Retired',
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  usage_start: 'Usage started',
  usage_stop: 'Usage stopped',
  cleaning: 'Cleaning',
  breakdown: 'Breakdown reported',
  amendment: 'Correction',
};

type ActiveForm = 'usage' | 'cleaning' | 'breakdown' | null;

// EQP-3/EQP-6/EQP-7: the scan-to-status-card view (SPEC.md §7.3) — live calibration status
// (color-coded), current status, last 5 logbook entries, and role-driven action buttons. As of
// EQP-6/7, log_usage/log_cleaning/report_breakdown are real logging actions; complete_pm remains
// a stub (EQP-9 not yet built) and record_calibration is handled on the desktop equipment detail
// page (a multi-field form with a certificate upload is a poor fit for a phone-first card).
export function EquipmentStatusCard({ equipmentId }: { equipmentId: string }) {
  const queryClient = useQueryClient();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [error, setError] = useState<string | null>(null);
  const [amendingEntryId, setAmendingEntryId] = useState<string | null>(null);
  const [amendmentNote, setAmendmentNote] = useState('');

  const { data: card, isLoading } = useQuery({
    queryKey: ['equipment-status-card', equipmentId],
    queryFn: () => fetchEquipmentStatusCard(equipmentId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['equipment-status-card', equipmentId] });
  }

  const usageStopMutation = useMutation({
    mutationFn: () => logUsageStop(equipmentId),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to stop usage.'),
  });

  const usageStartMutation = useMutation({
    mutationFn: (productBatchRef: string) => logUsageStart(equipmentId, productBatchRef),
    onSuccess: () => {
      setActiveForm(null);
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to start usage.'),
  });

  const cleaningMutation = useMutation({
    mutationFn: (cleaningType: 'routine' | 'full') => logCleaning(equipmentId, cleaningType as never),
    onSuccess: () => {
      setActiveForm(null);
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to log cleaning.'),
  });

  const breakdownMutation = useMutation({
    mutationFn: (input: { description: string; photo?: File }) => logBreakdown(equipmentId, input.description, input.photo),
    onSuccess: () => {
      setActiveForm(null);
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to report breakdown.'),
  });

  const amendMutation = useMutation({
    mutationFn: (description: string) => createLogbookAmendment(equipmentId, amendingEntryId as string, description),
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

  const calibration = CALIBRATION_STYLES[card.calibrationStatus];
  const lastUsageEntry = card.recentLogbookEntries.find((e) => e.entryType === 'usage_start' || e.entryType === 'usage_stop');
  const isUsageOpen = lastUsageEntry?.entryType === 'usage_start';

  function handleUsageStartSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    usageStartMutation.mutate(String(form.get('productBatchRef') ?? ''));
  }

  function handleBreakdownSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const photo = form.get('photo') as File | null;
    breakdownMutation.mutate({ description: String(form.get('description') ?? ''), photo: photo && photo.size > 0 ? photo : undefined });
  }

  function handleLogUsageClick(): void {
    setError(null);
    if (isUsageOpen) {
      usageStopMutation.mutate();
    } else {
      setActiveForm('usage');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-400">{card.equipmentCode}</p>
        <h1 className="text-lg font-semibold text-slate-900">{card.name}</h1>
        <p className="text-sm text-slate-600">
          {card.location}
          {card.isGmpCritical ? ' — GMP-critical' : ''}
        </p>
        <p className="mt-2 text-sm">
          Current status: <span className="font-medium">{STATUS_LABELS[card.status]}</span>
        </p>
      </div>

      <div className={`rounded-lg border p-3 text-center ${calibration.className}`}>
        <p className="text-xs font-medium uppercase tracking-wide">Calibration</p>
        <p className="text-xl font-bold">{calibration.label}</p>
        {card.calibrationNextDueDate && <p className="text-xs">Valid until {card.calibrationNextDueDate.slice(0, 10)}</p>}
      </div>

      {card.calibrationBlocksUsage && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-center text-sm font-medium text-red-700">
          Usage logging is blocked — calibration is overdue. Contact QA before use.
        </div>
      )}

      {card.status === 'do_not_use' && (
        <div className="rounded-lg border border-red-400 bg-red-100 p-3 text-center text-sm font-semibold text-red-800">
          DO NOT USE — awaiting QA disposition of a failed calibration.
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-400">Qualification</p>
          <p className={`text-sm ${QUALIFICATION_STYLES[card.qualificationStatus].className}`}>
            {QUALIFICATION_STYLES[card.qualificationStatus].label}
          </p>
          {card.qualificationNextDueDate && <p className="text-xs text-slate-500">Requal. due {card.qualificationNextDueDate.slice(0, 10)}</p>}
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-400">PM due</p>
          <p className={`text-sm ${PM_STYLES[card.pmStatus].className}`}>
            {card.pmDueDate ? card.pmDueDate.slice(0, 10) : 'Not scheduled'}
          </p>
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white p-3">
        <p className="text-xs uppercase text-slate-400">Last 5 logbook entries</p>
        {card.recentLogbookEntries.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No logbook entries yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            {card.recentLogbookEntries.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <p className={entry.entryType === 'amendment' ? 'italic' : undefined}>
                  <span className="font-medium text-slate-800">{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}</span>
                  {' — '}
                  {entry.performedByUserFullName} ({entry.occurredAt.slice(0, 16).replace('T', ' ')})
                </p>
                {entry.productBatchRef && <p className="text-xs text-slate-500">Batch/product: {entry.productBatchRef}</p>}
                {entry.cleaningType && <p className="text-xs text-slate-500">Type: {entry.cleaningType}</p>}
                {entry.description && <p className="text-xs text-slate-500">{entry.description}</p>}
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
      </div>

      <div className="grid grid-cols-2 gap-2">
        {card.availableActions.map((action) => {
          if (action === 'log_usage') {
            return (
              <button key={action} type="button" onClick={handleLogUsageClick} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900">
                {isUsageOpen ? 'Stop Usage' : 'Start Usage'}
              </button>
            );
          }
          if (action === 'log_cleaning') {
            return (
              <button key={action} type="button" onClick={() => { setError(null); setActiveForm('cleaning'); }} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900">
                Log Cleaning
              </button>
            );
          }
          if (action === 'report_breakdown') {
            return (
              <button key={action} type="button" onClick={() => { setError(null); setActiveForm('breakdown'); }} className="rounded border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700">
                Report Breakdown
              </button>
            );
          }
          return (
            <button
              key={action}
              type="button"
              disabled
              title="Available on the desktop equipment detail page / a future session"
              className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            >
              {action === 'record_calibration' ? 'Record Calibration' : action === 'complete_pm' ? 'Complete PM' : action}
            </button>
          );
        })}
      </div>

      {activeForm === 'usage' && (
        <form onSubmit={handleUsageStartSubmit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Start usage</p>
          <input name="productBatchRef" required placeholder="Product / batch reference" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setActiveForm(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={usageStartMutation.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Start</button>
          </div>
        </form>
      )}

      {activeForm === 'cleaning' && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Log cleaning</p>
          <div className="flex gap-2">
            <button type="button" disabled={cleaningMutation.isPending} onClick={() => cleaningMutation.mutate('routine')} className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm">Routine</button>
            <button type="button" disabled={cleaningMutation.isPending} onClick={() => cleaningMutation.mutate('full')} className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm">Full</button>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setActiveForm(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {activeForm === 'breakdown' && (
        <form onSubmit={handleBreakdownSubmit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-900">Report breakdown</p>
          <textarea name="description" required rows={3} placeholder="What happened?" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          <input name="photo" type="file" accept="image/jpeg,image/png" className="w-full text-xs" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setActiveForm(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={breakdownMutation.isPending} className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Submit</button>
          </div>
        </form>
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
              <button type="button" onClick={() => setAmendingEntryId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
              <button type="submit" disabled={amendMutation.isPending || !amendmentNote.trim()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Log correction</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
