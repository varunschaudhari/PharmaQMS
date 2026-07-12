import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchOpenPmTasks } from '../../../lib/equipment-api';

// EQP-9: QA/engineering-facing PM queue — every OPEN task, tenant-wide.
export function PmQueuePage() {
  const { data: tasks, isLoading } = useQuery({ queryKey: ['pm-tasks-open'], queryFn: fetchOpenPmTasks });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">PM queue</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (tasks ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No open PM tasks.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Equipment</th>
              <th className="py-1 pr-4 font-medium">Due date</th>
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
                <td className="py-2 pr-4">{task.dueDate.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
