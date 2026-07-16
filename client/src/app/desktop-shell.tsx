import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { NotificationBell } from '../components/ui/notification-bell';
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
          <NavLink to="/documents" end className={navLinkClass}>
            Documents
          </NavLink>
          <NavLink to="/equipment" end className={navLinkClass}>
            Equipment
          </NavLink>
          <NavLink to="/equipment/calibration/due" className={navLinkClass}>
            Calibration Due
          </NavLink>
          <NavLink to="/equipment/maintenance-tasks" className={navLinkClass}>
            Maintenance Queue
          </NavLink>
          <NavLink to="/equipment/pm-tasks" className={navLinkClass}>
            PM Queue
          </NavLink>
          <NavLink to="/equipment/calibration-agencies" end className={navLinkClass}>
            Cal. Agencies
          </NavLink>
          <NavLink to="/rooms" end className={navLinkClass}>
            Rooms
          </NavLink>
          <NavLink to="/rooms/cleaning/due" className={navLinkClass}>
            Cleaning Due
          </NavLink>
          <NavLink to="/materials" end className={navLinkClass}>
            Material Lots
          </NavLink>
          <NavLink to="/documents/review-due" className={navLinkClass}>
            Review Due
          </NavLink>
          <NavLink to="/training/my-assignments" className={navLinkClass}>
            My Trainings
          </NavLink>
          <NavLink to="/training/matrix" className={navLinkClass}>
            Training Matrix
          </NavLink>
          <NavLink to="/workflow/pending-tasks" className={navLinkClass}>
            Pending Tasks
          </NavLink>
          <NavLink to="/test-records" className={navLinkClass}>
            Test Records
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
          <NotificationBell />
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
