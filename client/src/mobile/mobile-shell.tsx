import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/context/auth-context';

// PLT-7 / SPEC.md §7.3 mobile UX: phone-first shell for /s/:code scan flows — deliberately NOT
// the desktop shell. The persistent "Logged in as {name}" banner (§5.3 no-shared-logins policy)
// and a fast user-switch that returns to the exact scanned target after re-login.
export function MobileShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function switchUser(): void {
    const target = encodeURIComponent(location.pathname + location.search);
    logout();
    navigate(`/login?redirect=${target}`, { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex items-center justify-between bg-slate-900 px-4 py-2 text-white">
        <span className="truncate text-sm">
          Logged in as <strong>{user?.fullName ?? 'Unknown'}</strong>
        </span>
        <button type="button" onClick={switchUser} className="ml-3 shrink-0 rounded border border-slate-500 px-2 py-1 text-xs">
          Switch user
        </button>
      </div>
      <main className="mx-auto w-full max-w-md p-4">{children}</main>
    </div>
  );
}
