import { SignatureMeaning, WorkflowInstanceStatus } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PendingTasksPage } from './pending-tasks-page';

const { fetchMyPendingTasks } = vi.hoisted(() => ({
  fetchMyPendingTasks: vi.fn(),
}));

vi.mock('../../../lib/workflow-api', () => ({
  fetchMyPendingTasks,
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PendingTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PLT-4 PendingTasksPage', () => {
  it('PLT-4: shows a message when there is nothing awaiting the user', async () => {
    fetchMyPendingTasks.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Nothing awaiting your action.')).toBeInTheDocument());
  });

  it('PLT-4: lists pending tasks with a link to review each one', async () => {
    fetchMyPendingTasks.mockResolvedValue([
      {
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
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('DR-0001')).toBeInTheDocument());
    expect(screen.getByText('Dept Head Review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review/i })).toHaveAttribute('href', '/workflow/instances/instance-1');
  });
});
