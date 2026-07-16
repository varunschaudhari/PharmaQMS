import { CalibrationAgencyStatus } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  fetchCalibrationAgency,
  openCalibrationAgencyCertificate,
  transitionCalibrationAgencyStatus,
  updateCalibrationAgency,
  uploadCalibrationAgencyCertificate,
} from '../../../lib/calibration-agency-api';

// EQP-11: calibration agency detail — metadata edit, status transition (reversible), accreditation
// certificate uploads/downloads, and the mandatory HistoryTab.
export function CalibrationAgencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: agency, isLoading } = useQuery({
    queryKey: ['calibration-agency', id],
    queryFn: () => fetchCalibrationAgency(id as string),
    enabled: Boolean(id),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['calibration-agency', id] });
    void queryClient.invalidateQueries({ queryKey: ['audit-history', 'CalibrationAgency', id] });
  }

  const updateMutation = useMutation({
    mutationFn: (payload: { accreditationNumber?: string; accreditationValidUntil?: string }) => updateCalibrationAgency(id as string, payload),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to update agency.'),
  });

  const statusMutation = useMutation({
    mutationFn: (status: CalibrationAgencyStatus) => transitionCalibrationAgencyStatus(id as string, status),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to change status.'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCalibrationAgencyCertificate(id as string, file),
    onSuccess: invalidate,
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to upload certificate.'),
  });

  function handleAccreditationSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateMutation.mutate({
      accreditationNumber: String(form.get('accreditationNumber') ?? ''),
      accreditationValidUntil: String(form.get('accreditationValidUntil') ?? ''),
    });
  }

  function handleCertificateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Read .files directly off the input rather than via `new FormData(form).get('file')` —
    // the latter unreliably returns null in jsdom/vitest even after user.upload() correctly sets
    // the input's .files (same workaround EQP-8's qualification form needed).
    const fileInput = event.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file || file.size === 0) {
      setError('A certificate file is required.');
      return;
    }
    uploadMutation.mutate(file);
    event.currentTarget.reset();
  }

  if (isLoading || !agency) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const expired = agency.accreditationValidUntil !== null && new Date(agency.accreditationValidUntil) < new Date();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{agency.status === 'active' ? 'Active' : 'Suspended'}</p>
        <h1 className="text-lg font-semibold text-slate-900">{agency.name}</h1>
        <p className="text-sm text-slate-600">
          {agency.contactName ?? '—'} {agency.contactEmail ? `— ${agency.contactEmail}` : ''} {agency.contactPhone ? `— ${agency.contactPhone}` : ''}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {expired && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-700">
          Accreditation expired {agency.accreditationValidUntil!.slice(0, 10)} — this is a warning only; recording calibrations remains possible, but is audited while this flag is present.
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Accreditation</h2>
        <form onSubmit={handleAccreditationSubmit} className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <input name="accreditationNumber" placeholder="Accreditation no." defaultValue={agency.accreditationNumber ?? ''} className="rounded border border-slate-300 px-2 py-1" />
          <input name="accreditationValidUntil" type="date" defaultValue={agency.accreditationValidUntil?.slice(0, 10) ?? ''} className="rounded border border-slate-300 px-2 py-1" />
          <button type="submit" disabled={updateMutation.isPending} className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
            Save
          </button>
        </form>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Status</h2>
        <div className="mt-2 flex gap-2">
          {agency.status === CalibrationAgencyStatus.ACTIVE ? (
            <button type="button" onClick={() => statusMutation.mutate(CalibrationAgencyStatus.SUSPENDED)} disabled={statusMutation.isPending} className="rounded border border-amber-400 px-3 py-1.5 text-sm text-amber-700 disabled:opacity-50">
              Suspend
            </button>
          ) : (
            <button type="button" onClick={() => statusMutation.mutate(CalibrationAgencyStatus.ACTIVE)} disabled={statusMutation.isPending} className="rounded border border-emerald-500 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-50">
              Reactivate
            </button>
          )}
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Accreditation certificates</h2>
        {agency.certificates.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No certificates uploaded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {agency.certificates.map((certificate) => (
              <li key={certificate.id}>
                <button type="button" onClick={() => void openCalibrationAgencyCertificate(agency.id, certificate.id)} className="text-slate-600 underline">
                  {certificate.fileName}
                </button>
                <span className="ml-2 text-xs text-slate-400">{certificate.uploadedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleCertificateSubmit} className="mt-3 flex items-center gap-2">
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" className="text-xs" />
          <button type="submit" disabled={uploadMutation.isPending} className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">
            Upload certificate
          </button>
        </form>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="CalibrationAgency" entityId={agency.id} />
      </section>
    </div>
  );
}
