import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/context/auth-context';

// PLT-8: client-side mirror of the server's PlatformAdminGuard — a real gate still lives on the
// server; this only avoids showing platform-admin-only navigation/pages to tenant users.
export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }
  if (!user?.isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
