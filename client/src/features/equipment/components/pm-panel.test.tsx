import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { PmPanel } from './pm-panel';

const { fetchPmPlan, fetchPmTasksForEquipment, upsertPmPlan, completePmTask } = vi.hoisted(() => ({
  fetchPmPlan: vi.fn(),
  fetchPmTasksForEquipment: vi.fn(),
  upsertPmPlan: vi.fn(),
  completePmTask: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({ fetchPmPlan, fetchPmTasksForEquipment, upsertPmPlan, completePmTask }));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../../lib/esign-api', () => ({ challengeSignature }));

function renderPanel(permissions: string[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <PmPanel equipmentId="eq-1" />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('EQP-9 PmPanel', () => {
  it('EQP-9: an engineer creates a PM plan', async () => {
    const user = userEvent.setup();
    fetchPmPlan.mockResolvedValue(null);
    fetchPmTasksForEquipment.mockResolvedValue([]);
    upsertPmPlan.mockResolvedValue({});
    renderPanel(['equipment:edit']);

    await waitFor(() => expect(screen.getByPlaceholderText('Frequency (months)')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Frequency (months)'), '6');
    await user.type(screen.getByLabelText('Next due date'), '2026-01-01');
    await user.type(screen.getByPlaceholderText('Checklist (what to check)'), 'Check belts, lubricate bearings.');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));

    await waitFor(() =>
      expect(upsertPmPlan).toHaveBeenCalledWith('eq-1', expect.objectContaining({ frequencyMonths: 6, checklistText: 'Check belts, lubricate bearings.' })),
    );
  });

  it('EQP-9 / Iron Rule 4: completing a task requires a note, then an e-signature', async () => {
    const user = userEvent.setup();
    fetchPmPlan.mockResolvedValue({ id: 'plan-1', tenantId: 't1', equipmentId: 'eq-1', frequencyMonths: 6, checklistText: 'Checklist.', nextDueDate: '2026-01-01T00:00:00.000Z' });
    fetchPmTasksForEquipment.mockResolvedValue([
      { id: 'task-1', tenantId: 't1', equipmentId: 'eq-1', planId: 'plan-1', status: 'open', dueDate: '2026-01-01T00:00:00.000Z', completionNote: null, completedByUserId: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    challengeSignature.mockResolvedValue({ signingToken: 'tok-1', expiresAt: '2026-01-01T00:00:00.000Z' });
    completePmTask.mockResolvedValue({});
    renderPanel(['equipment:edit']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Complete' }));

    const continueButton = screen.getByRole('button', { name: 'Continue to sign' });
    expect(continueButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Completion note (required)'), 'Serviced per checklist.');
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(screen.getByText('PM Completed by')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(completePmTask).toHaveBeenCalledWith('task-1', 'tok-1', 'Serviced per checklist.'));
  });

  it('EQP-9: a user with no equipment:edit cannot see the complete button', async () => {
    fetchPmPlan.mockResolvedValue({ id: 'plan-1', tenantId: 't1', equipmentId: 'eq-1', frequencyMonths: 6, checklistText: 'Checklist.', nextDueDate: '2026-01-01T00:00:00.000Z' });
    fetchPmTasksForEquipment.mockResolvedValue([
      { id: 'task-1', tenantId: 't1', equipmentId: 'eq-1', planId: 'plan-1', status: 'open', dueDate: '2026-01-01T00:00:00.000Z', completionNote: null, completedByUserId: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    renderPanel([]);
    await waitFor(() => expect(screen.getByText('Open')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });
});
