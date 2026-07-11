import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { createDepartment, fetchDepartments, updateDepartment } from '../../../lib/admin-api';

export function DepartmentsPage() {
  const queryClient = useQueryClient();
  const { data: departments, isLoading } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => {
      setName('');
      setCode('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create department.'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateDepartment(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['departments'] }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate({ name, code });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Departments</h1>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-4">
        <div>
          <label htmlFor="dept-name" className="block text-xs font-medium text-slate-700">
            Name
          </label>
          <input
            id="dept-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="dept-code" className="block text-xs font-medium text-slate-700">
            Code
          </label>
          <input
            id="dept-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm uppercase"
          />
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add department
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Name</th>
              <th className="py-1 pr-4 font-medium">Code</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(departments ?? []).map((department) => (
              <tr key={department.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{department.name}</td>
                <td className="py-2 pr-4">{department.code}</td>
                <td className="py-2 pr-4">{department.isActive ? 'Active' : 'Inactive'}</td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() =>
                      toggleActiveMutation.mutate({ id: department.id, isActive: !department.isActive })
                    }
                    className="text-slate-600 underline"
                  >
                    {department.isActive ? 'Deactivate' : 'Activate'}
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
