import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchCalibrationAgencies } from '../../../lib/calibration-agency-api';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-amber-100 text-amber-700',
};

// EQP-11: external calibration agency register.
export function CalibrationAgenciesListPage() {
  const { data: agencies, isLoading } = useQuery({ queryKey: ['calibration-agencies'], queryFn: fetchCalibrationAgencies });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Calibration Agencies</h1>
        <div className="flex items-center gap-3">
          <Link to="/equipment/calibration-agencies/due" className="text-sm text-slate-600 underline">
            Due by agency
          </Link>
          <Link to="/equipment/calibration-agencies/certificates" className="text-sm text-slate-600 underline">
            Certificate registry
          </Link>
          <Link to="/equipment/calibration-agencies/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            New agency
          </Link>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (agencies ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No calibration agencies configured yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Name</th>
              <th className="py-1 pr-4 font-medium">Accreditation No.</th>
              <th className="py-1 pr-4 font-medium">Valid until</th>
              <th className="py-1 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(agencies ?? []).map((agency) => {
              const expired = agency.accreditationValidUntil !== null && new Date(agency.accreditationValidUntil) < new Date();
              return (
                <tr key={agency.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium">
                    <Link to={`/equipment/calibration-agencies/${agency.id}`} className="underline">
                      {agency.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{agency.accreditationNumber ?? '—'}</td>
                  <td className={`py-2 pr-4 ${expired ? 'font-semibold text-red-600' : ''}`}>
                    {agency.accreditationValidUntil ? agency.accreditationValidUntil.slice(0, 10) : '—'}
                    {expired && ' (expired)'}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[agency.status]}`}>
                      {agency.status === 'active' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
