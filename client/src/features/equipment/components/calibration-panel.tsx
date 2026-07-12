import { CalibrationDispositionOutcome, CalibrationResult, SignatureMeaning } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { useAuth } from '../../auth/context/auth-context';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  dispositionCalibrationRecord,
  fetchCalibrationRecords,
  fetchCalibrationSchedule,
  recordCalibrationResult,
  upsertCalibrationSchedule,
  verifyCalibrationRecord,
} from '../../../lib/equipment-api';

const EDIT_PERMISSION = 'equipment:edit';
const APPROVE_PERMISSION = 'equipment:approve';

// EQP-4/EQP-5: calibration schedule + record management, nested in the equipment detail page.
// Scheduling/recording is gated to equipment:edit (engineering); QA verify/disposition sign-offs
// are gated to equipment:approve — the same split enforced server-side by CalibrationController.
export function CalibrationPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [signingRecordId, setSigningRecordId] = useState<string | null>(null);
  const [dispositionRecordId, setDispositionRecordId] = useState<string | null>(null);
  // Two-step flow: fill in the outcome/note first, THEN (and only then) the signature dialog
  // appears — never both at once.
  const [dispositionStep, setDispositionStep] = useState<'note' | 'sign'>('note');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionOutcome, setDispositionOutcome] = useState<CalibrationDispositionOutcome>(
    CalibrationDispositionOutcome.RELEASE,
  );

  function closeDispositionDialog(): void {
    setDispositionRecordId(null);
    setDispositionStep('note');
    setDispositionNote('');
    setDispositionOutcome(CalibrationDispositionOutcome.RELEASE);
  }

  const canEdit = user?.permissions.includes(EDIT_PERMISSION) ?? false;
  const canApprove = user?.permissions.includes(APPROVE_PERMISSION) ?? false;

  const { data: schedule } = useQuery({
    queryKey: ['calibration-schedule', equipmentId],
    queryFn: () => fetchCalibrationSchedule(equipmentId),
  });
  const { data: records } = useQuery({
    queryKey: ['calibration-records', equipmentId],
    queryFn: () => fetchCalibrationRecords(equipmentId),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['calibration-schedule', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['calibration-records', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['equipment', equipmentId] });
    void queryClient.invalidateQueries({ queryKey: ['audit-history', 'Equipment', equipmentId] });
  }

  const scheduleMutation = useMutation({
    mutationFn: (input: {
      frequencyMonths: number;
      parameters: string;
      toleranceClass: string;
      agencyType: 'internal' | 'external';
      agencyName?: string;
      nextDueDate: string;
    }) => upsertCalibrationSchedule(equipmentId, input),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to save calibration schedule.'),
  });

  const recordMutation = useMutation({
    mutationFn: (input: {
      performedDate: string;
      result: 'pass' | 'fail';
      toleranceNotes?: string;
      impactAssessmentNote?: string;
      file: File;
    }) => recordCalibrationResult(equipmentId, input),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to record calibration result.'),
  });

  const verifyMutation = useMutation({
    mutationFn: (signingToken: string) => verifyCalibrationRecord(equipmentId, signingRecordId as string, signingToken),
    onSuccess: () => {
      setSigningRecordId(null);
      invalidate();
    },
    onError: (err) => {
      setSigningRecordId(null);
      setError(extractErrorMessage(err) ?? 'Failed to verify calibration record.');
    },
  });

  const dispositionMutation = useMutation({
    mutationFn: (signingToken: string) =>
      dispositionCalibrationRecord(equipmentId, dispositionRecordId as string, {
        signingToken,
        outcome: dispositionOutcome,
        note: dispositionNote,
      }),
    onSuccess: () => {
      closeDispositionDialog();
      invalidate();
    },
    onError: (err) => {
      closeDispositionDialog();
      setError(extractErrorMessage(err) ?? 'Failed to disposition calibration record.');
    },
  });

  function handleScheduleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    scheduleMutation.mutate({
      frequencyMonths: Number(form.get('frequencyMonths')),
      parameters: String(form.get('parameters') ?? ''),
      toleranceClass: String(form.get('toleranceClass') ?? ''),
      agencyType: form.get('agencyType') === 'external' ? 'external' : 'internal',
      agencyName: String(form.get('agencyName') ?? '') || undefined,
      nextDueDate: String(form.get('nextDueDate') ?? ''),
    });
  }

  function handleRecordSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file') as File | null;
    if (!file || file.size === 0) {
      setError('A calibration certificate file is required.');
      return;
    }
    recordMutation.mutate({
      performedDate: String(form.get('performedDate') ?? ''),
      result: form.get('result') === 'fail' ? 'fail' : 'pass',
      toleranceNotes: String(form.get('toleranceNotes') ?? '') || undefined,
      impactAssessmentNote: String(form.get('impactAssessmentNote') ?? '') || undefined,
      file,
    });
    event.currentTarget.reset();
  }

  return (
    <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Calibration (EQP-4/EQP-5)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Schedule</h3>
        {schedule ? (
          <p className="mt-1 text-sm text-slate-700">
            Every {schedule.frequencyMonths} month(s) — {schedule.parameters} ({schedule.toleranceClass}),{' '}
            {schedule.agencyType === 'external' ? schedule.agencyName ?? 'External agency' : 'Internal'}. Next due{' '}
            {schedule.nextDueDate.slice(0, 10)}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No calibration schedule configured yet.</p>
        )}

        {canEdit && (
          <form onSubmit={handleScheduleSubmit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <input name="frequencyMonths" type="number" min={1} placeholder="Frequency (months)" required defaultValue={schedule?.frequencyMonths} className="rounded border border-slate-300 px-2 py-1" />
            <input name="toleranceClass" placeholder="Tolerance class" required defaultValue={schedule?.toleranceClass} className="rounded border border-slate-300 px-2 py-1" />
            <input name="parameters" placeholder="Parameters" required defaultValue={schedule?.parameters} className="col-span-2 rounded border border-slate-300 px-2 py-1" />
            <select name="agencyType" defaultValue={schedule?.agencyType ?? 'internal'} className="rounded border border-slate-300 px-2 py-1">
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </select>
            <input name="agencyName" placeholder="Agency name (if external)" defaultValue={schedule?.agencyName ?? ''} className="rounded border border-slate-300 px-2 py-1" />
            <input
              name="nextDueDate"
              aria-label="Next due date"
              type="date"
              required
              defaultValue={schedule?.nextDueDate.slice(0, 10)}
              className="col-span-2 rounded border border-slate-300 px-2 py-1"
            />
            <button type="submit" disabled={scheduleMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
              {schedule ? 'Update schedule' : 'Create schedule'}
            </button>
          </form>
        )}
      </div>

      {canEdit && (
        <div className="rounded border border-slate-200 p-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Record a calibration result</h3>
          <form onSubmit={handleRecordSubmit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <input name="performedDate" aria-label="Performed date" type="date" required className="rounded border border-slate-300 px-2 py-1" />
            <select name="result" className="rounded border border-slate-300 px-2 py-1">
              <option value={CalibrationResult.PASS}>Pass</option>
              <option value={CalibrationResult.FAIL}>Fail (out-of-tolerance)</option>
            </select>
            <input name="toleranceNotes" placeholder="Tolerance notes (optional)" className="col-span-2 rounded border border-slate-300 px-2 py-1" />
            <textarea
              name="impactAssessmentNote"
              placeholder="Impact-assessment note — required if the result is Fail"
              rows={2}
              className="col-span-2 rounded border border-slate-300 px-2 py-1"
            />
            <input name="file" type="file" required className="col-span-2 text-xs" />
            <button type="submit" disabled={recordMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
              Record result
            </button>
          </form>
        </div>
      )}

      <div className="rounded border border-slate-200 p-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Records</h3>
        {!records || records.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No calibration records yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {records.map((record) => (
              <li key={record.id} className="rounded border border-slate-200 p-2 text-sm">
                <p>
                  {record.performedDate.slice(0, 10)} —{' '}
                  <span className={record.result === 'fail' ? 'font-semibold text-red-600' : 'font-medium text-emerald-700'}>
                    {record.result.toUpperCase()}
                  </span>{' '}
                  — {record.status.replace(/_/g, ' ')}
                </p>
                {record.impactAssessmentNote && <p className="text-xs text-slate-600">Impact: {record.impactAssessmentNote}</p>}
                {canApprove && record.result === 'pass' && record.status === 'pending_qa_verification' && (
                  <button
                    type="button"
                    onClick={() => setSigningRecordId(record.id)}
                    className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    QA verify
                  </button>
                )}
                {canApprove && record.result === 'fail' && record.status === 'pending_qa_verification' && (
                  <button
                    type="button"
                    onClick={() => setDispositionRecordId(record.id)}
                    className="mt-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                  >
                    QA disposition
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {signingRecordId && (
        <SignatureDialog
          meaning={SignatureMeaning.VERIFIED_BY}
          onSign={(token) => verifyMutation.mutateAsync(token)}
          onCancel={() => setSigningRecordId(null)}
        />
      )}

      {dispositionRecordId && dispositionStep === 'note' && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">QA Disposition</h2>
            <select
              value={dispositionOutcome}
              onChange={(event) => setDispositionOutcome(event.target.value as CalibrationDispositionOutcome)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value={CalibrationDispositionOutcome.RELEASE}>Release — return to Active</option>
              <option value={CalibrationDispositionOutcome.RETAIN_DO_NOT_USE}>Retain — keep Do Not Use</option>
            </select>
            <textarea
              value={dispositionNote}
              onChange={(event) => setDispositionNote(event.target.value)}
              placeholder="Disposition note (required)"
              rows={3}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeDispositionDialog} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={!dispositionNote.trim()}
                onClick={() => setDispositionStep('sign')}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Continue to sign
              </button>
            </div>
          </div>
        </div>
      )}
      {dispositionRecordId && dispositionStep === 'sign' && (
        <SignatureDialog
          meaning={SignatureMeaning.QA_DISPOSITION}
          onSign={(token) => dispositionMutation.mutateAsync(token)}
          onCancel={closeDispositionDialog}
        />
      )}
    </section>
  );
}
