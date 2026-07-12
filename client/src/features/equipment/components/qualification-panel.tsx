import { QualificationResult, QualificationType } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context/auth-context';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  attachQualificationReport,
  fetchQualificationRecords,
  openQualificationFile,
  recordQualification,
} from '../../../lib/equipment-api';

const EDIT_PERMISSION = 'equipment:edit';

// EQP-8: qualification records (IQ/OQ/PQ/REQUALIFICATION). No e-signature — SPEC's one-line
// EQP-8 requirement never mentions one (unlike EQP-4/9) — so this is a plain permission-gated
// (equipment:edit) form, same as calibration recording.
export function QualificationPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [attachingRecordId, setAttachingRecordId] = useState<string | null>(null);

  const canEdit = user?.permissions.includes(EDIT_PERMISSION) ?? false;

  const { data: records } = useQuery({
    queryKey: ['qualification-records', equipmentId],
    queryFn: () => fetchQualificationRecords(equipmentId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['qualification-records', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['equipment-status-card', equipmentId] });
  }

  const recordMutation = useMutation({
    mutationFn: (input: Parameters<typeof recordQualification>[1]) => recordQualification(equipmentId, input),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to record qualification.'),
  });

  const attachReportMutation = useMutation({
    mutationFn: (report: File) => attachQualificationReport(equipmentId, attachingRecordId as string, report),
    onSuccess: () => {
      setAttachingRecordId(null);
      invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to attach report.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    // Read file inputs directly from the DOM rather than via FormData.get() — file-input
    // serialization through a FormData built from a form element is inconsistent across test/
    // runtime environments, while `.files` on the element itself is always reliable.
    const protocol = (formEl.elements.namedItem('protocol') as HTMLInputElement | null)?.files?.[0] ?? null;
    if (!protocol || protocol.size === 0) {
      setError('A protocol file is required.');
      return;
    }
    const report = (formEl.elements.namedItem('report') as HTMLInputElement | null)?.files?.[0] ?? null;
    const frequency = String(form.get('requalificationFrequencyMonths') ?? '');
    recordMutation.mutate({
      qualificationType: form.get('qualificationType') as QualificationType,
      performedDate: String(form.get('performedDate') ?? ''),
      result: form.get('result') as QualificationResult,
      notes: String(form.get('notes') ?? '') || undefined,
      requalificationFrequencyMonths: frequency ? Number(frequency) : undefined,
      protocol,
      report: report && report.size > 0 ? report : undefined,
    });
    formEl.reset();
  }

  function handleAttachReportSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const report = (event.currentTarget.elements.namedItem('report') as HTMLInputElement | null)?.files?.[0] ?? null;
    if (!report || report.size === 0) {
      setError('A report file is required.');
      return;
    }
    attachReportMutation.mutate(report);
  }

  return (
    <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Qualification (EQP-8)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {canEdit && (
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-3 text-sm">
          <select name="qualificationType" className="rounded border border-slate-300 px-2 py-1">
            <option value={QualificationType.IQ}>IQ</option>
            <option value={QualificationType.OQ}>OQ</option>
            <option value={QualificationType.PQ}>PQ</option>
            <option value={QualificationType.REQUALIFICATION}>Requalification</option>
          </select>
          <select name="result" className="rounded border border-slate-300 px-2 py-1">
            <option value={QualificationResult.PASS}>Pass</option>
            <option value={QualificationResult.FAIL}>Fail</option>
          </select>
          <input name="performedDate" aria-label="Performed date" type="date" required className="rounded border border-slate-300 px-2 py-1" />
          <input name="requalificationFrequencyMonths" type="number" min={1} placeholder="Requal. frequency (months, PQ only)" className="rounded border border-slate-300 px-2 py-1" />
          <input name="notes" placeholder="Notes (optional)" className="col-span-2 rounded border border-slate-300 px-2 py-1" />
          <label className="col-span-2 text-xs text-slate-500">
            Protocol (required)
            {/* Not HTML-`required`: file-input constraint validation is unreliable across
                environments; the mandatory check is enforced in handleSubmit below instead. */}
            <input name="protocol" type="file" className="mt-1 block w-full text-xs" />
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Report (optional — can be attached later)
            <input name="report" type="file" className="mt-1 block w-full text-xs" />
          </label>
          <button type="submit" disabled={recordMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
            Record qualification
          </button>
        </form>
      )}

      {!records || records.length === 0 ? (
        <p className="text-sm text-slate-500">No qualification records yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {records.map((record) => (
            <li key={record.id} className="rounded border border-slate-200 p-2">
              <p>
                <span className="font-medium uppercase">{record.qualificationType}</span> — {record.performedDate.slice(0, 10)} —{' '}
                <span className={record.result === 'fail' ? 'font-semibold text-red-600' : 'text-emerald-700'}>{record.result.toUpperCase()}</span>
              </p>
              {record.notes && <p className="text-xs text-slate-500">{record.notes}</p>}
              {record.requalificationFrequencyMonths && <p className="text-xs text-slate-500">Requalification every {record.requalificationFrequencyMonths} month(s)</p>}
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => void openQualificationFile(equipmentId, record.id, 'protocol')} className="text-xs text-slate-500 underline">
                  View protocol
                </button>
                {record.reportFileName ? (
                  <button type="button" onClick={() => void openQualificationFile(equipmentId, record.id, 'report')} className="text-xs text-slate-500 underline">
                    View report
                  </button>
                ) : (
                  canEdit && (
                    <button type="button" onClick={() => setAttachingRecordId(record.id)} className="text-xs text-slate-500 underline">
                      Attach report
                    </button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {attachingRecordId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <form onSubmit={handleAttachReportSubmit} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">Attach qualification report</h2>
            <input name="report" aria-label="Report file" type="file" className="w-full text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAttachingRecordId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={attachReportMutation.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                Attach
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
