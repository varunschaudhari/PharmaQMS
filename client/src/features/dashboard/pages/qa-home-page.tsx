import { CalibrationStatus } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/context/auth-context';
import { fetchCalibrationDue } from '../../../lib/equipment-api';
import { fetchOverdueTraining } from '../../../lib/training-api';
import { fetchReviewDue } from '../../../lib/documents-api';
import { fetchMyPendingTasks } from '../../../lib/workflow-api';

const MAX_ROWS = 5;

function DashboardCard({
  title,
  count,
  viewAllTo,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  viewAllTo: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {title} <span className={count > 0 ? 'text-red-600' : 'text-slate-400'}>({count})</span>
        </h2>
        <Link to={viewAllTo} className="text-xs text-slate-600 underline">
          View all
        </Link>
      </div>
      {count === 0 ? <p className="mt-2 text-sm text-slate-500">{emptyLabel}</p> : <ul className="mt-2 space-y-1 text-sm">{children}</ul>}
    </section>
  );
}

// SPEC.md §8 item 13: QA home dashboard — pending approvals, overdue calibrations, training
// overdue, documents due for periodic review, each drilling into its own already-built module
// page. Purely a client-side aggregation of PLT-4/EQP-4/TRN-5/DOC-6's existing dashboard-feed
// endpoints — no new backend endpoint needed. Each widget is gated on the permission its own
// full-list page already requires (workflow pending-tasks needs none), same pattern as the
// Tenants nav link's isPlatformAdmin gate in desktop-shell.tsx.
export function QaHomePage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const canViewEquipment = permissions.includes('equipment:view');
  const canViewTraining = permissions.includes('training:view');
  const canViewDocuments = permissions.includes('documents:view');

  const { data: pendingTasks, isLoading: pendingLoading } = useQuery({
    queryKey: ['my-pending-tasks'],
    queryFn: fetchMyPendingTasks,
  });

  const { data: calibrationDue, isLoading: calibrationLoading } = useQuery({
    queryKey: ['calibration-due'],
    queryFn: fetchCalibrationDue,
    enabled: canViewEquipment,
  });

  const { data: trainingOverdue, isLoading: trainingLoading } = useQuery({
    queryKey: ['training-overdue'],
    queryFn: fetchOverdueTraining,
    enabled: canViewTraining,
  });

  const { data: reviewDue, isLoading: reviewLoading } = useQuery({
    queryKey: ['documents-review-due'],
    queryFn: fetchReviewDue,
    enabled: canViewDocuments,
  });

  const overdueCalibrations = (calibrationDue ?? []).filter((entry) => entry.calibrationStatus === CalibrationStatus.OVERDUE);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">QA home</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DashboardCard
          title="Pending approvals"
          count={pendingTasks?.length ?? 0}
          viewAllTo="/workflow/pending-tasks"
          emptyLabel={pendingLoading ? 'Loading…' : 'Nothing awaiting your action.'}
        >
          {(pendingTasks ?? []).slice(0, MAX_ROWS).map((task) => (
            <li key={task.id}>
              <Link to={`/workflow/instances/${task.id}`} className="underline">
                {task.entityType} — {task.entityId}
              </Link>
              <span className="text-slate-500"> — {task.currentStep?.name ?? '—'}</span>
            </li>
          ))}
        </DashboardCard>

        {canViewEquipment && (
          <DashboardCard
            title="Overdue calibrations"
            count={overdueCalibrations.length}
            viewAllTo="/equipment/calibration/due"
            emptyLabel={calibrationLoading ? 'Loading…' : 'No equipment is overdue for calibration.'}
          >
            {overdueCalibrations.slice(0, MAX_ROWS).map((entry) => (
              <li key={entry.equipmentId}>
                <Link to={`/equipment/${entry.equipmentId}`} className="underline">
                  {entry.equipmentCode} — {entry.equipmentName}
                </Link>
                <span className="text-slate-500"> — due {entry.nextDueDate.slice(0, 10)}</span>
              </li>
            ))}
          </DashboardCard>
        )}

        {canViewTraining && (
          <DashboardCard
            title="Training overdue"
            count={trainingOverdue?.length ?? 0}
            viewAllTo="/training/overdue"
            emptyLabel={trainingLoading ? 'Loading…' : 'No overdue training.'}
          >
            {(trainingOverdue ?? []).slice(0, MAX_ROWS).map((assignment) => (
              <li key={assignment.id}>
                <Link to={`/training/employees/${assignment.userId}`} className="underline">
                  {assignment.userFullName}
                </Link>
                <span className="text-slate-500"> — {assignment.docNumber}</span>
              </li>
            ))}
          </DashboardCard>
        )}

        {canViewDocuments && (
          <DashboardCard
            title="Documents due for periodic review"
            count={reviewDue?.length ?? 0}
            viewAllTo="/documents/review-due"
            emptyLabel={reviewLoading ? 'Loading…' : 'No documents are due for periodic review.'}
          >
            {(reviewDue ?? []).slice(0, MAX_ROWS).map((document) => (
              <li key={document.id}>
                <Link to={`/documents/${document.id}`} className="underline">
                  {document.docNumber}
                </Link>
                <span className="text-slate-500"> — {document.title}</span>
              </li>
            ))}
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
