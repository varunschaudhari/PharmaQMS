import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { createUser, fetchDepartments, fetchRoles, fetchUsers, updateUser } from '../../../lib/admin-api';

export function UsersPage() {
  const queryClient = useQueryClient();
  const { data: usersResult, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers(1, 50) });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setEmail('');
      setFullName('');
      setPassword('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create user.'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateUser(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!roleId) {
      setError('Select a role.');
      return;
    }
    createMutation.mutate({ email, fullName, password, roleId, departmentId: departmentId || undefined });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Users</h1>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-4">
        <div>
          <label htmlFor="user-email" className="block text-xs font-medium text-slate-700">
            Email
          </label>
          <input
            id="user-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="user-name" className="block text-xs font-medium text-slate-700">
            Full name
          </label>
          <input
            id="user-name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="user-password" className="block text-xs font-medium text-slate-700">
            Temporary password
          </label>
          <input
            id="user-password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="user-role" className="block text-xs font-medium text-slate-700">
            Role
          </label>
          <select
            id="user-role"
            required
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Select…</option>
            {(roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="user-department" className="block text-xs font-medium text-slate-700">
            Department
          </label>
          <select
            id="user-department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">None</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add user
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
              <th className="py-1 pr-4 font-medium">Email</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(usersResult?.data ?? []).map((user) => (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{user.fullName}</td>
                <td className="py-2 pr-4">{user.email}</td>
                <td className="py-2 pr-4">{user.isActive ? 'Active' : 'Inactive'}</td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => toggleActiveMutation.mutate({ id: user.id, isActive: !user.isActive })}
                    className="text-slate-600 underline"
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
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
