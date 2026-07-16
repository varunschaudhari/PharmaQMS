import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { downloadCalibrationDueByAgencyCsv, downloadCalibrationDueByAgencyPdf, fetchCalibrationDueByAgency } from '../../../lib/calibration-agency-api';

const STATUS_STYLES: Record<string, string> = {
  due_soon: 'text-amber-600',
  overdue: 'font-semibold text-red-600',
};

// EQP-11 (c): agency-wise due list — "this is what QA sends the agency each month," grouped by
// agency, exportable to CSV.
export function CalibrationDueByAgencyPage() {
  const { data: due, isLoading } = useQuery({ queryKey: ['calibration-due-by-agency'], queryFn: fetchCalibrationDueByAgency });

  const grouped = new Map<string, { agencyName: string; entries: NonNullable<typeof due> }>();
  for (const entry of due ?? []) {
    const group = grouped.get(entry.agencyId) ?? { agencyName: entry.agencyName, entries: [] };
    group.entries.push(entry);
    grouped.set(entry.agencyId, group);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Calibration due by agency</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => void downloadCalibrationDueByAgencyCsv()} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            Export CSV
          </button>
          <button type="button" onClick={() => void downloadCalibrationDueByAgencyPdf()} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            Export PDF
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : grouped.size === 0 ? (
        <p className="text-sm text-slate-500">No externally-calibrated equipment is due or overdue.</p>
      ) : (
        [...grouped.entries()].map(([agencyId, group]) => (
          <section key={agencyId} className="rounded border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              <Link to={`/equipment/calibration-agencies/${agencyId}`} className="underline">
                {group.agencyName}
              </Link>
            </h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1 pr-4 font-medium">Equipment</th>
                  <th className="py-1 pr-4 font-medium">Status</th>
                  <th className="py-1 pr-4 font-medium">Next due</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.equipmentId} className="border-b border-slate-100">
                    <td className="py-2 pr-4">
                      <Link to={`/equipment/${entry.equipmentId}`} className="underline">
                        {entry.equipmentCode} — {entry.equipmentName}
                      </Link>
                    </td>
                    <td className={`py-2 pr-4 ${STATUS_STYLES[entry.calibrationStatus] ?? ''}`}>{entry.calibrationStatus.replace('_', ' ').toUpperCase()}</td>
                    <td className="py-2 pr-4">
                      {entry.nextDueDate.slice(0, 10)}
                      {entry.accreditationExpired && <span className="ml-2 text-xs font-semibold text-red-600">(accreditation expired)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
