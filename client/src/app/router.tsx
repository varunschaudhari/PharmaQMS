import { Route, Routes } from 'react-router-dom';
import { DepartmentsPage } from '../features/admin/pages/departments-page';
import { NumberingSchemesPage } from '../features/admin/pages/numbering-schemes-page';
import { TenantsPage } from '../features/admin/pages/tenants-page';
import { UsersPage } from '../features/admin/pages/users-page';
import { LoginPage } from '../features/auth/pages/login-page';
import { PendingTasksPage } from '../features/workflow/pages/pending-tasks-page';
import { WorkflowInstancePage } from '../features/workflow/pages/workflow-instance-page';
import { DesktopShell } from './desktop-shell';
import { PlatformAdminRoute } from './platform-admin-route';
import { ProtectedRoute } from './protected-route';

function ScaffoldHomePage() {
  return (
    <p className="text-slate-600">
      Phase 0 scaffold — business modules (DOC/TRN/EQP) not yet implemented.
    </p>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <ScaffoldHomePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/departments"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <DepartmentsPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <UsersPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/numbering"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <NumberingSchemesPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/tenants"
        element={
          <ProtectedRoute>
            <PlatformAdminRoute>
              <DesktopShell>
                <TenantsPage />
              </DesktopShell>
            </PlatformAdminRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/workflow/pending-tasks"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <PendingTasksPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/workflow/instances/:id"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <WorkflowInstancePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
