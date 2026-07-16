import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalibrationAgencies, fetchCalibrationCertificateRegistry, openCalibrationRecordCertificate } from '../../../lib/calibration-agency-api';

// EQP-11 (e): certificate registry — every uploaded calibration certificate, filterable by
// agency/equipment/date.
export function CalibrationCertificateRegistryPage() {
  const [agencyId, setAgencyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data: agencies } = useQuery({ queryKey: ['calibration-agencies'], queryFn: fetchCalibrationAgencies });
  const { data: entries, isLoading } = useQuery({
    queryKey: ['calibration-certificate-registry', agencyId, fromDate, toDate],
    queryFn: () => fetchCalibrationCertificateRegistry({ agencyId: agencyId || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Calibration certificate registry</h1>

      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filter by agency" value={agencyId} onChange={(event) => setAgencyId(event.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">All agencies</option>
          {(agencies ?? []).map((agency) => (
            <option key={agency.id} value={agency.id}>
              {agency.name}
            </option>
          ))}
        </select>
        <input aria-label="From date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
        <input aria-label="To date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (entries ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No calibration certificates match these filters.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Equipment</th>
              <th className="py-1 pr-4 font-medium">Agency</th>
              <th className="py-1 pr-4 font-medium">Performed</th>
              <th className="py-1 pr-4 font-medium">Result</th>
              <th className="py-1 pr-4 font-medium">Certificate</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((entry) => (
              <tr key={entry.recordId} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  <Link to={`/equipment/${entry.equipmentId}`} className="underline">
                    {entry.equipmentCode} — {entry.equipmentName}
                  </Link>
                </td>
                <td className="py-2 pr-4">{entry.agencyName ?? '—'}</td>
                <td className="py-2 pr-4">{entry.performedDate.slice(0, 10)}</td>
                <td className={entry.result === 'fail' ? 'py-2 pr-4 font-semibold text-red-600' : 'py-2 pr-4 text-emerald-700'}>{entry.result.toUpperCase()}</td>
                <td className="py-2 pr-4">
                  <button type="button" onClick={() => void openCalibrationRecordCertificate(entry.equipmentId, entry.recordId)} className="text-slate-600 underline">
                    {entry.certificateFileName}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
