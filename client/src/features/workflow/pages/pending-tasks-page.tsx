import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchMyPendingTasks } from '../../../lib/workflow-api';

export function PendingTasksPage() {
  const { data: tasks, isLoading } = useQuery({ queryKey: ['my-pending-tasks'], queryFn: fetchMyPendingTasks });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">My pending tasks</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (tasks ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">Nothing awaiting your action.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Entity type</th>
              <th className="py-1 pr-4 font-medium">Entity</th>
              <th className="py-1 pr-4 font-medium">Current step</th>
              <th className="py-1 pr-4 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(tasks ?? []).map((task) => (
              <tr key={task.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{task.entityType}</td>
                <td className="py-2 pr-4">{task.entityId}</td>
                <td className="py-2 pr-4">{task.currentStep?.name ?? '—'}</td>
                <td className="py-2 pr-4">
                  <Link to={`/workflow/instances/${task.id}`} className="text-slate-600 underline">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
