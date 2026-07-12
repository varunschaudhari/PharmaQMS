import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExportAuditButton } from '../../../components/ui/export-audit-button';
import { fetchDepartments, fetchRoles } from '../../../lib/admin-api';
import { fetchTrainingMatrix } from '../../../lib/training-api';

// TRN-1: admin overview — role/department × document mapping (DOC-9), with live completion
// counts. Editing the mapping happens on the document's own detail page (natural ownership);
// this view is read-only monitoring, linking out to each document.
export function TrainingMatrixPage() {
  const { data: matrix, isLoading } = useQuery({ queryKey: ['training-matrix'], queryFn: fetchTrainingMatrix });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const roleName = (id: string) => roles?.find((r) => r.id === id)?.name ?? id;
  const departmentName = (id: string) => departments?.find((d) => d.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Training matrix</h1>
        <div className="flex items-center gap-3">
          <ExportAuditButton entityType="TrainingAssignment" label="Export audit history (CSV)" />
          <Link to="/training/overdue" className="text-sm text-slate-600 underline">
            View overdue
          </Link>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (matrix ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No documents have a training distribution configured yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Document</th>
              <th className="py-1 pr-4 font-medium">Roles</th>
              <th className="py-1 pr-4 font-medium">Departments</th>
              <th className="py-1 pr-4 font-medium">Assigned</th>
              <th className="py-1 pr-4 font-medium">Completed</th>
              <th className="py-1 pr-4 font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {(matrix ?? []).map((entry) => (
              <tr key={entry.documentId} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">
                  <Link to={`/documents/${entry.documentId}`} className="underline">
                    {entry.docNumber}
                  </Link>
                  <span className="block text-xs text-slate-500">{entry.title}</span>
                </td>
                <td className="py-2 pr-4">{entry.distributionRoleIds.map(roleName).join(', ') || '—'}</td>
                <td className="py-2 pr-4">{entry.distributionDepartmentIds.map(departmentName).join(', ') || '—'}</td>
                <td className="py-2 pr-4">{entry.totalAssigned}</td>
                <td className="py-2 pr-4">{entry.totalCompleted}</td>
                <td className={`py-2 pr-4 ${entry.totalOverdue > 0 ? 'font-semibold text-red-600' : ''}`}>{entry.totalOverdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
