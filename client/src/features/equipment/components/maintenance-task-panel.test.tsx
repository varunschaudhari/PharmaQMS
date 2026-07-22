import type { PermissionKey } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { MaintenanceTaskPanel } from './maintenance-task-panel';

const { fetchMaintenanceTasksForEquipment, closeMaintenanceTask, verifyMaintenanceTask } = vi.hoisted(() => ({
  fetchMaintenanceTasksForEquipment: vi.fn(),
  closeMaintenanceTask: vi.fn(),
  verifyMaintenanceTask: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({ fetchMaintenanceTasksForEquipment, closeMaintenanceTask, verifyMaintenanceTask }));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../../lib/esign-api', () => ({ challengeSignature }));

function renderPanel(permissions: PermissionKey[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MaintenanceTaskPanel equipmentId="eq-1" />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

const baseTask = {
  id: 'task-1', tenantId: 't1', equipmentId: 'eq-1', equipmentCode: 'EQP-0001', equipmentName: 'Autoclave',
  sourceLogbookEntryId: 'e1', assignedRoleId: null, engineerCompletionNote: null, completedByUserId: null,
  completedAt: null, verificationRequired: true, verifiedByUserId: null, verifiedAt: null, verificationNote: null,
  createdAt: '2026-07-11T00:00:00.000Z',
};

describe('EQP-7 MaintenanceTaskPanel', () => {
  it('EQP-7: an engineer closes an open task with a completion note', async () => {
    const user = userEvent.setup();
    fetchMaintenanceTasksForEquipment.mockResolvedValue([{ ...baseTask, status: 'open' }]);
    closeMaintenanceTask.mockResolvedValue({});

    renderPanel(['equipment:edit']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close (completion note)' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Close (completion note)' }));
    await user.type(screen.getByPlaceholderText('Completion note (required)'), 'Replaced the door seal.');
    await user.click(screen.getByRole('button', { name: 'Close task' }));

    await waitFor(() => expect(closeMaintenanceTask).toHaveBeenCalledWith('task-1', 'Replaced the door seal.'));
  });

  it('EQP-7: QA verifies a pending-verification task via e-signature', async () => {
    const user = userEvent.setup();
    fetchMaintenanceTasksForEquipment.mockResolvedValue([{ ...baseTask, status: 'pending_verification', engineerCompletionNote: 'Replaced the seal.' }]);
    challengeSignature.mockResolvedValue({ signingToken: 'tok-1', expiresAt: '2026-01-01T00:00:00.000Z' });
    verifyMaintenanceTask.mockResolvedValue({});

    renderPanel(['equipment:approve']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(verifyMaintenanceTask).toHaveBeenCalledWith('task-1', 'tok-1'));
  });

  it('EQP-7: an operator with no equipment permissions sees tasks read-only', async () => {
    fetchMaintenanceTasksForEquipment.mockResolvedValue([{ ...baseTask, status: 'open' }]);
    renderPanel([]);
    await waitFor(() => expect(screen.getByText('Open')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Close (completion note)' })).not.toBeInTheDocument();
  });
});
