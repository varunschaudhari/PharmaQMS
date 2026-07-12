import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchCalibrationDue } from '../../../lib/equipment-api';

const STATUS_STYLES: Record<string, string> = {
  due_soon: 'text-amber-600',
  overdue: 'font-semibold text-red-600',
};

// EQP-4: QA-facing calibration-due dashboard.
export function CalibrationDuePage() {
  const { data: due, isLoading } = useQuery({ queryKey: ['calibration-due'], queryFn: fetchCalibrationDue });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Calibration due</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (due ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No equipment is due or overdue for calibration.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Equipment</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Next due</th>
            </tr>
          </thead>
          <tbody>
            {(due ?? []).map((entry) => (
              <tr key={entry.equipmentId} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  <Link to={`/equipment/${entry.equipmentId}`} className="underline">
                    {entry.equipmentCode} — {entry.equipmentName}
                  </Link>
                </td>
                <td className={`py-2 pr-4 ${STATUS_STYLES[entry.calibrationStatus] ?? ''}`}>
                  {entry.calibrationStatus.replace('_', ' ').toUpperCase()}
                </td>
                <td className="py-2 pr-4">{entry.nextDueDate.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
