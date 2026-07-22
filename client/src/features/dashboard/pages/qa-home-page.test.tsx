import type { PermissionKey } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { QaHomePage } from './qa-home-page';

const { fetchMyPendingTasks } = vi.hoisted(() => ({ fetchMyPendingTasks: vi.fn() }));
vi.mock('../../../lib/workflow-api', () => ({ fetchMyPendingTasks }));

const { fetchCalibrationDue } = vi.hoisted(() => ({ fetchCalibrationDue: vi.fn() }));
vi.mock('../../../lib/equipment-api', () => ({ fetchCalibrationDue }));

const { fetchOverdueTraining } = vi.hoisted(() => ({ fetchOverdueTraining: vi.fn() }));
vi.mock('../../../lib/training-api', () => ({ fetchOverdueTraining }));

const { fetchReviewDue } = vi.hoisted(() => ({ fetchReviewDue: vi.fn() }));
vi.mock('../../../lib/documents-api', () => ({ fetchReviewDue }));

function renderPage(permissions: PermissionKey[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <QaHomePage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

// SPEC.md §8 item 13: QA home dashboard — a client-side aggregation of PLT-4's pending-tasks,
// EQP-4's calibration-due, TRN-5's training-overdue, and DOC-6's review-due feeds.
describe('QA home dashboard', () => {
  it('PLT-4: shows pending approvals with no permission gate, even with no other module access', async () => {
    fetchMyPendingTasks.mockResolvedValue([
      { id: 'wf-1', entityType: 'Document', entityId: 'doc-1', currentStep: { name: 'QA Review' } },
    ]);

    renderPage([]);

    expect(await screen.findByText(/Document — doc-1/)).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();

    // No equipment:view/training:view/documents:view — those widgets must not render at all.
    expect(screen.queryByText(/Overdue calibrations/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Training overdue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Documents due for periodic review/)).not.toBeInTheDocument();
  });

  it('EQP-4/TRN-5/DOC-6: shows overdue calibrations (filtered from due_soon+overdue), training overdue, and review-due widgets when permitted', async () => {
    fetchMyPendingTasks.mockResolvedValue([]);
    fetchCalibrationDue.mockResolvedValue([
      { equipmentId: 'eq-1', equipmentCode: 'EQP-0001', equipmentName: 'Autoclave', departmentId: 'd1', calibrationStatus: 'overdue', nextDueDate: '2026-01-01T00:00:00.000Z' },
      { equipmentId: 'eq-2', equipmentCode: 'EQP-0002', equipmentName: 'pH Meter', departmentId: 'd1', calibrationStatus: 'due_soon', nextDueDate: '2026-08-01T00:00:00.000Z' },
    ]);
    fetchOverdueTraining.mockResolvedValue([
      { id: 'ta-1', userId: 'u1', userFullName: 'Olive Operator', docNumber: 'SOP-QA-001', documentTitle: 'Cleaning SOP', isOverdue: true },
    ]);
    fetchReviewDue.mockResolvedValue([{ id: 'doc-1', docNumber: 'SOP-QA-002', title: 'Change Control SOP' }]);

    renderPage(['equipment:view', 'training:view', 'documents:view']);

    // Only the OVERDUE calibration entry counts — the DUE_SOON one is excluded from this widget.
    expect(await screen.findByText(/EQP-0001 — Autoclave/)).toBeInTheDocument();
    expect(screen.queryByText(/EQP-0002/)).not.toBeInTheDocument();

    expect(await screen.findByText('Olive Operator')).toBeInTheDocument();
    expect(await screen.findByText(/SOP-QA-002/)).toBeInTheDocument();
  });
});
