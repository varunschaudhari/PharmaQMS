import type { PermissionKey } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { TrainingAssessmentPanel } from './training-assessment-panel';

const { fetchTrainingAssessmentForAuthoring, upsertTrainingAssessment, approveTrainingAssessment } = vi.hoisted(() => ({
  fetchTrainingAssessmentForAuthoring: vi.fn(),
  upsertTrainingAssessment: vi.fn(),
  approveTrainingAssessment: vi.fn(),
}));
vi.mock('../../../lib/training-assessment-api', () => ({
  fetchTrainingAssessmentForAuthoring,
  upsertTrainingAssessment,
  approveTrainingAssessment,
}));

function renderPanel(permissions: PermissionKey[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TrainingAssessmentPanel documentId="doc-1" versionId="ver-1" versionLabel="1.0" docNumber="SOP-QA-001" />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('TRN-6 TrainingAssessmentPanel', () => {
  beforeEach(() => {
    fetchTrainingAssessmentForAuthoring.mockResolvedValue(null);
  });

  it('TRN-6: a QA author adds a question and saves the question bank as Draft', async () => {
    const user = userEvent.setup();
    upsertTrainingAssessment.mockResolvedValue({
      id: 'assess-1',
      tenantId: 't1',
      documentId: 'doc-1',
      versionId: 'ver-1',
      docNumber: 'SOP-QA-001',
      versionLabel: '1.0',
      status: 'draft',
      questions: [],
      createdByUserId: 'u1',
      approvedByUserId: null,
      approvedAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
    });

    renderPanel(['training:edit']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add question' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await user.type(screen.getByLabelText('Question 1 text'), 'What is the required cleaning frequency?');
    await user.type(screen.getByLabelText('Question 1 option 1'), 'Daily');
    await user.type(screen.getByLabelText('Question 1 option 2'), 'Weekly');

    await user.click(screen.getByRole('button', { name: 'Save question bank' }));

    await waitFor(() =>
      expect(upsertTrainingAssessment).toHaveBeenCalledWith('doc-1', 'ver-1', {
        docNumber: 'SOP-QA-001',
        versionLabel: '1.0',
        questions: [{ questionText: 'What is the required cleaning frequency?', options: ['Daily', 'Weekly'], correctOptionIndex: 0 }],
      }),
    );
  });

  it('TRN-6: a QA approver sees the Approve button only while the assessment is Draft', async () => {
    fetchTrainingAssessmentForAuthoring.mockResolvedValue({
      id: 'assess-1',
      tenantId: 't1',
      documentId: 'doc-1',
      versionId: 'ver-1',
      docNumber: 'SOP-QA-001',
      versionLabel: '1.0',
      status: 'draft',
      questions: [{ id: 'q1', questionText: 'Q1?', options: ['A', 'B'], correctOptionIndex: 0 }],
      createdByUserId: 'u1',
      approvedByUserId: null,
      approvedAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    const user = userEvent.setup();
    approveTrainingAssessment.mockResolvedValue({});

    renderPanel(['training:edit', 'training:approve']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve for trainees' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Approve for trainees' }));

    await waitFor(() => expect(approveTrainingAssessment).toHaveBeenCalledWith('doc-1', 'ver-1'));
  });

  it('TRN-6: a non-editor with no assessment configured renders nothing', async () => {
    renderPanel([]);
    await waitFor(() => expect(fetchTrainingAssessmentForAuthoring).toHaveBeenCalled());
    expect(screen.queryByText(/Assessment \(TRN-6\)/)).not.toBeInTheDocument();
  });
});
