import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchOverdueTraining } from '../../../lib/training-api';

// TRN-5: overdue tracking — QA dashboard widget.
export function TrainingOverduePage() {
  const { data: overdue, isLoading } = useQuery({ queryKey: ['training-overdue'], queryFn: fetchOverdueTraining });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Overdue training</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (overdue ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No overdue training.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Employee</th>
              <th className="py-1 pr-4 font-medium">Document</th>
              <th className="py-1 pr-4 font-medium">Version</th>
              <th className="py-1 pr-4 font-medium">Due date</th>
            </tr>
          </thead>
          <tbody>
            {(overdue ?? []).map((assignment) => (
              <tr key={assignment.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  <Link to={`/training/employees/${assignment.userId}`} className="underline">
                    {assignment.userFullName}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {assignment.docNumber} — {assignment.documentTitle}
                </td>
                <td className="py-2 pr-4">{assignment.versionLabel}</td>
                <td className="py-2 pr-4 font-semibold text-red-600">{assignment.dueDate?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
