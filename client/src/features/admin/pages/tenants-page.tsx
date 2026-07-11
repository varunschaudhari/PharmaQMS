import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { createTenant, fetchTenants } from '../../../lib/admin-api';

// PLT-8: platform-admin only — see ../../../app/platform-admin-route.tsx and the server's
// PlatformAdminGuard. Tenant provisioning is a cross-tenant, platform-operator concern.
export function TenantsPage() {
  const queryClient = useQueryClient();
  const { data: tenants, isLoading } = useQuery({ queryKey: ['tenants'], queryFn: fetchTenants });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createTenant,
    onSuccess: () => {
      setName('');
      setSlug('');
      setAdminEmail('');
      setAdminFullName('');
      setAdminPassword('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create tenant.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate({
      name,
      slug,
      initialAdmin: { email: adminEmail, fullName: adminFullName, password: adminPassword },
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Tenants</h1>
      <p className="text-sm text-slate-600">Platform administrator only.</p>

      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor="tenant-name" className="block text-xs font-medium text-slate-700">
              Tenant name
            </label>
            <input
              id="tenant-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label htmlFor="tenant-slug" className="block text-xs font-medium text-slate-700">
              Slug
            </label>
            <input
              id="tenant-slug"
              required
              placeholder="acme-pharma"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
        <p className="text-xs font-medium text-slate-500">Initial tenant admin</p>
        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-medium text-slate-700">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label htmlFor="admin-fullname" className="block text-xs font-medium text-slate-700">
              Full name
            </label>
            <input
              id="admin-fullname"
              required
              value={adminFullName}
              onChange={(event) => setAdminFullName(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-xs font-medium text-slate-700">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              required
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Provision tenant
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
              <th className="py-1 pr-4 font-medium">Slug</th>
              <th className="py-1 pr-4 font-medium">Timezone</th>
              <th className="py-1 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((tenant) => (
              <tr key={tenant.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{tenant.name}</td>
                <td className="py-2 pr-4">{tenant.slug}</td>
                <td className="py-2 pr-4">{tenant.settings.timezone}</td>
                <td className="py-2 pr-4">{tenant.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
