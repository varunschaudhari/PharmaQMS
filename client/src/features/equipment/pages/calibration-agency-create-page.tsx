import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractErrorMessage } from '../../../lib/api-error';
import { createCalibrationAgency } from '../../../lib/calibration-agency-api';

// EQP-11: new external calibration agency record.
export function CalibrationAgencyCreatePage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [accreditationNumber, setAccreditationNumber] = useState('');
  const [accreditationValidUntil, setAccreditationValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createCalibrationAgency({
        name,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        accreditationNumber: accreditationNumber || undefined,
        accreditationValidUntil: accreditationValidUntil || undefined,
      }),
    onSuccess: (agency) => navigate(`/equipment/calibration-agencies/${agency.id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create calibration agency.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">New calibration agency</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="agency-name" className="block text-sm font-medium text-slate-700">
            Name
          </label>
          <input id="agency-name" required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="agency-contact-name" className="block text-sm font-medium text-slate-700">
              Contact name
            </label>
            <input id="agency-contact-name" value={contactName} onChange={(event) => setContactName(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="agency-contact-phone" className="block text-sm font-medium text-slate-700">
              Contact phone
            </label>
            <input id="agency-contact-phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label htmlFor="agency-contact-email" className="block text-sm font-medium text-slate-700">
            Contact email
          </label>
          <input id="agency-contact-email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="agency-accreditation-number" className="block text-sm font-medium text-slate-700">
              Accreditation no. (e.g. NABL)
            </label>
            <input
              id="agency-accreditation-number"
              value={accreditationNumber}
              onChange={(event) => setAccreditationNumber(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="agency-accreditation-valid-until" className="block text-sm font-medium text-slate-700">
              Accreditation valid until
            </label>
            <input
              id="agency-accreditation-valid-until"
              type="date"
              value={accreditationValidUntil}
              onChange={(event) => setAccreditationValidUntil(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={createMutation.isPending} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          Create agency
        </button>
      </form>
    </div>
  );
}
