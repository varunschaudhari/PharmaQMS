import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../features/auth/context/auth-context';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm ${isActive ? 'font-semibold text-slate-900' : 'text-slate-600'}`;

export function DesktopShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">PharmaQMS</h1>
        <nav className="flex items-center gap-4">
          <NavLink to="/" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/workflow/pending-tasks" className={navLinkClass}>
            Pending Tasks
          </NavLink>
          <NavLink to="/admin/departments" className={navLinkClass}>
            Departments
          </NavLink>
          <NavLink to="/admin/users" className={navLinkClass}>
            Users
          </NavLink>
          <NavLink to="/admin/numbering" className={navLinkClass}>
            Numbering
          </NavLink>
          {user?.isPlatformAdmin && (
            <NavLink to="/admin/tenants" className={navLinkClass}>
              Tenants
            </NavLink>
          )}
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
