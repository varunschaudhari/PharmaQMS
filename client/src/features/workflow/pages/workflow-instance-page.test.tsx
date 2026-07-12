import { SignatureMeaning, WorkflowInstanceStatus } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowInstancePage } from './workflow-instance-page';

const { fetchWorkflowInstance, actOnWorkflowStep } = vi.hoisted(() => ({
  fetchWorkflowInstance: vi.fn(),
  actOnWorkflowStep: vi.fn(),
}));

const { challengeSignature } = vi.hoisted(() => ({
  challengeSignature: vi.fn(),
}));

const { fetchAuditHistory } = vi.hoisted(() => ({
  fetchAuditHistory: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
}));

vi.mock('../../../lib/workflow-api', () => ({
  fetchWorkflowInstance,
  actOnWorkflowStep,
}));

vi.mock('../../../lib/esign-api', () => ({
  challengeSignature,
}));

vi.mock('../../../lib/audit-api', () => ({
  fetchAuditHistory,
  downloadAuditRecordExport: vi.fn(),
  downloadAuditModuleExport: vi.fn(),
}));

function baseInstance() {
  return {
    id: 'instance-1',
    tenantId: 'tenant-1',
    templateId: 'template-1',
    entityType: 'dummy-record',
    entityId: 'DR-0001',
    status: WorkflowInstanceStatus.IN_PROGRESS,
    currentStepIndex: 0,
    currentStep: {
      name: 'Dept Head Review',
      roleId: 'role-1',
      signatureMeaning: SignatureMeaning.REVIEWED_BY,
      rejectToStepIndex: null,
    },
    overrideAssigneeUserId: null,
    totalSteps: 2,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workflow/instances/instance-1']}>
        <Routes>
          <Route path="/workflow/instances/:id" element={<WorkflowInstancePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PLT-4 WorkflowInstancePage', () => {
  it('PLT-4: approves the current step after a successful signature challenge', async () => {
    const user = userEvent.setup();
    fetchWorkflowInstance.mockResolvedValue(baseInstance());
    challengeSignature.mockResolvedValue({ signingToken: 'signing-token-1', expiresAt: '2026-01-01T00:00:00.000Z' });
    actOnWorkflowStep.mockResolvedValue({ ...baseInstance(), currentStepIndex: 1 });

    renderPage();

    await waitFor(() => expect(screen.getByText('Step 1 of 2: Dept Head Review')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() =>
      expect(actOnWorkflowStep).toHaveBeenCalledWith('instance-1', {
        action: 'approve',
        signingToken: 'signing-token-1',
        entitySnapshot: { entityType: 'dummy-record', entityId: 'DR-0001' },
      }),
    );
  });

  it('PLT-4: rejects with a mandatory comment', async () => {
    const user = userEvent.setup();
    fetchWorkflowInstance.mockResolvedValue(baseInstance());
    actOnWorkflowStep.mockResolvedValue({ ...baseInstance(), status: WorkflowInstanceStatus.DRAFT, currentStep: null });

    renderPage();

    await waitFor(() => expect(screen.getByText('Step 1 of 2: Dept Head Review')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^reject$/i }));

    const confirmButton = screen.getByRole('button', { name: /confirm rejection/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/reason for rejection/i), 'Missing signature page.');
    await user.click(confirmButton);

    await waitFor(() =>
      expect(actOnWorkflowStep).toHaveBeenCalledWith('instance-1', {
        action: 'reject',
        comment: 'Missing signature page.',
      }),
    );
  });

  it('PLT-2: includes the HistoryTab for the underlying entity (audited against entityType/entityId, not the instance id)', async () => {
    fetchWorkflowInstance.mockResolvedValue(baseInstance());

    renderPage();

    await waitFor(() => expect(screen.getByText('Step 1 of 2: Dept Head Review')).toBeInTheDocument());
    await waitFor(() => expect(fetchAuditHistory).toHaveBeenCalledWith('dummy-record', 'DR-0001', 1, 20));
  });
});
