import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { downloadEmployeeTrainingRecordPdf, fetchEmployeeTrainingRecord } from '../../../lib/training-api';

// TRN-4: per-employee training record — "the first thing auditors ask for" (SPEC §7.2).
export function EmployeeRecordPage() {
  const { userId } = useParams<{ userId: string }>();
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['employee-training-record', userId],
    queryFn: () => fetchEmployeeTrainingRecord(userId as string),
    enabled: Boolean(userId),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Training record</h1>
        <button
          type="button"
          onClick={() => void downloadEmployeeTrainingRecordPdf(userId as string)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          Download PDF
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Document</th>
              <th className="py-1 pr-4 font-medium">Version</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Assigned</th>
              <th className="py-1 pr-4 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {(assignments ?? []).map((assignment) => (
              <tr key={assignment.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">{assignment.docNumber}</td>
                <td className="py-2 pr-4">{assignment.versionLabel}</td>
                <td className="py-2 pr-4">{assignment.status}</td>
                <td className="py-2 pr-4">{assignment.assignedAt.slice(0, 10)}</td>
                <td className="py-2 pr-4">{assignment.completedAt ? assignment.completedAt.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
