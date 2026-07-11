import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/context/auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
