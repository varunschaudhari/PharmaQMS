import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MyTrainingsPage } from './my-trainings-page';

const { fetchMyTrainingAssignments, completeTrainingAssignment } = vi.hoisted(() => ({
  fetchMyTrainingAssignments: vi.fn(),
  completeTrainingAssignment: vi.fn(),
}));
vi.mock('../../../lib/training-api', () => ({ fetchMyTrainingAssignments, completeTrainingAssignment }));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../../lib/esign-api', () => ({ challengeSignature }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyTrainingsPage />
    </QueryClientProvider>,
  );
}

describe('TRN-2 MyTrainingsPage', () => {
  it('TRN-2: shows a pending assignment and completes it with an e-signature (Trained — read and understood)', async () => {
    const user = userEvent.setup();
    fetchMyTrainingAssignments.mockResolvedValue([
      {
        id: 'assign-1',
        tenantId: 't1',
        userId: 'u1',
        userFullName: 'Olive Operator',
        documentId: 'doc-1',
        docNumber: 'SOP-QA-001',
        documentTitle: 'Cleaning of pH meters',
        versionId: 'ver-1',
        versionLabel: '1.0',
        status: 'pending',
        assignedAt: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-08T00:00:00.000Z',
        isOverdue: false,
        completedAt: null,
      },
    ]);
    challengeSignature.mockResolvedValue({ signingToken: 'signing-token-1', expiresAt: '2026-01-01T00:00:00.000Z' });
    completeTrainingAssignment.mockResolvedValue({ status: 'completed' });

    renderPage();

    await waitFor(() => expect(screen.getByText('SOP-QA-001')).toBeInTheDocument());
    expect(screen.getByText('Cleaning of pH meters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /i have read and understood/i }));
    expect(screen.getByText('Trained — read and understood')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(completeTrainingAssignment).toHaveBeenCalledWith('assign-1', 'signing-token-1'));
  });

  it('TRN-2: shows nothing-pending message when there are no open assignments', async () => {
    fetchMyTrainingAssignments.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/nothing pending/i)).toBeInTheDocument());
  });
});
