import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchOpenMaintenanceTasks } from '../../../lib/equipment-api';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending_verification: 'Pending Verification',
};

// EQP-7: QA/engineering-facing maintenance queue — every task not yet fully closed, tenant-wide.
export function MaintenanceQueuePage() {
  const { data: tasks, isLoading } = useQuery({ queryKey: ['maintenance-tasks-open'], queryFn: fetchOpenMaintenanceTasks });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Maintenance queue</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (tasks ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No open maintenance tasks.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Equipment</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {(tasks ?? []).map((task) => (
              <tr key={task.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  <Link to={`/equipment/${task.equipmentId}`} className="underline">
                    {task.equipmentCode} — {task.equipmentName}
                  </Link>
                </td>
                <td className="py-2 pr-4">{STATUS_LABELS[task.status] ?? task.status}</td>
                <td className="py-2 pr-4">{task.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
