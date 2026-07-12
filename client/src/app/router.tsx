import { Route, Routes } from 'react-router-dom';
import { DepartmentsPage } from '../features/admin/pages/departments-page';
import { NumberingSchemesPage } from '../features/admin/pages/numbering-schemes-page';
import { TenantsPage } from '../features/admin/pages/tenants-page';
import { UsersPage } from '../features/admin/pages/users-page';
import { LoginPage } from '../features/auth/pages/login-page';
import { QaHomePage } from '../features/dashboard/pages/qa-home-page';
import { PendingTasksPage } from '../features/workflow/pages/pending-tasks-page';
import { WorkflowInstancePage } from '../features/workflow/pages/workflow-instance-page';
import { DocumentCreatePage } from '../features/documents/pages/document-create-page';
import { DocumentDetailPage } from '../features/documents/pages/document-detail-page';
import { DocumentNewVersionPage } from '../features/documents/pages/document-new-version-page';
import { DocumentsPage } from '../features/documents/pages/documents-page';
import { ReviewDuePage } from '../features/documents/pages/review-due-page';
import { CalibrationDuePage } from '../features/equipment/pages/calibration-due-page';
import { EquipmentCreatePage } from '../features/equipment/pages/equipment-create-page';
import { EquipmentDetailPage } from '../features/equipment/pages/equipment-detail-page';
import { EquipmentListPage } from '../features/equipment/pages/equipment-list-page';
import { MaintenanceQueuePage } from '../features/equipment/pages/maintenance-queue-page';
import { PmQueuePage } from '../features/equipment/pages/pm-queue-page';
import { TestRecordDetailPage } from '../features/test-records/pages/test-record-detail-page';
import { TestRecordsPage } from '../features/test-records/pages/test-records-page';
import { EmployeeRecordPage } from '../features/training/pages/employee-record-page';
import { MyTrainingsPage } from '../features/training/pages/my-trainings-page';
import { TrainingMatrixPage } from '../features/training/pages/training-matrix-page';
import { TrainingOverduePage } from '../features/training/pages/training-overdue-page';
import { ScanLandingPage } from '../mobile/pages/scan-landing-page';
import { DesktopShell } from './desktop-shell';
import { PlatformAdminRoute } from './platform-admin-route';
import { ProtectedRoute } from './protected-route';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* PLT-7: mobile scan landing — no desktop shell; handles its own auth redirect so the
          scanned target survives login (SPEC.md §7.3 mobile UX). */}
      <Route path="/s/:code" element={<ScanLandingPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <QaHomePage />
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
        path="/documents"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <DocumentsPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/new"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <DocumentCreatePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/review-due"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <ReviewDuePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <DocumentDetailPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/:id/new-version"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <DocumentNewVersionPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/my-assignments"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <MyTrainingsPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/matrix"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <TrainingMatrixPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/overdue"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <TrainingOverduePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/employees/:userId"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <EmployeeRecordPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <EquipmentListPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment/new"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <EquipmentCreatePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment/calibration/due"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <CalibrationDuePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment/maintenance-tasks"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <MaintenanceQueuePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment/pm-tasks"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <PmQueuePage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipment/:id"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <EquipmentDetailPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/test-records"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <TestRecordsPage />
            </DesktopShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/test-records/:id"
        element={
          <ProtectedRoute>
            <DesktopShell>
              <TestRecordDetailPage />
            </DesktopShell>
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
