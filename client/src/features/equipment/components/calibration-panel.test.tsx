import type { PermissionKey } from '@pharmaqms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { CalibrationPanel } from './calibration-panel';

const {
  fetchCalibrationSchedule,
  fetchCalibrationRecords,
  upsertCalibrationSchedule,
  recordCalibrationResult,
  verifyCalibrationRecord,
  dispositionCalibrationRecord,
} = vi.hoisted(() => ({
  fetchCalibrationSchedule: vi.fn(),
  fetchCalibrationRecords: vi.fn(),
  upsertCalibrationSchedule: vi.fn(),
  recordCalibrationResult: vi.fn(),
  verifyCalibrationRecord: vi.fn(),
  dispositionCalibrationRecord: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({
  fetchCalibrationSchedule,
  fetchCalibrationRecords,
  upsertCalibrationSchedule,
  recordCalibrationResult,
  verifyCalibrationRecord,
  dispositionCalibrationRecord,
}));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../../lib/esign-api', () => ({ challengeSignature }));

function renderPanel(permissions: PermissionKey[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <CalibrationPanel equipmentId="eq-1" />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('EQP-4 EQP-5 CalibrationPanel', () => {
  beforeEach(() => {
    fetchCalibrationSchedule.mockResolvedValue(null);
    fetchCalibrationRecords.mockResolvedValue([]);
    challengeSignature.mockResolvedValue({ signingToken: 'tok-1', expiresAt: '2026-01-01T00:00:00.000Z' });
  });

  it('EQP-4: an operator with no equipment:edit/approve sees records but no schedule/record forms', async () => {
    fetchCalibrationRecords.mockResolvedValue([
      { id: 'rec-1', tenantId: 't1', equipmentId: 'eq-1', scheduleId: 'sch-1', performedDate: '2026-01-01T00:00:00.000Z', result: 'pass', certificateFileName: 'c.pdf', certificateContentType: 'application/pdf', toleranceNotes: null, impactAssessmentNote: null, status: 'pending_qa_verification', deviationRef: null, recordedByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    renderPanel([]);

    await waitFor(() => expect(screen.getByText(/PASS/)).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('Parameters')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'QA verify' })).not.toBeInTheDocument();
  });

  it('EQP-4: an engineer can create a calibration schedule', async () => {
    const user = userEvent.setup();
    upsertCalibrationSchedule.mockResolvedValue({
      id: 'sch-1', tenantId: 't1', equipmentId: 'eq-1', frequencyMonths: 12,
      parameters: 'pH buffers', toleranceClass: 'Class A', agencyType: 'internal', agencyName: null,
      nextDueDate: '2026-01-01T00:00:00.000Z',
    });
    renderPanel(['equipment:edit']);

    await waitFor(() => expect(screen.getByPlaceholderText('Parameters')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Frequency (months)'), '12');
    await user.type(screen.getByPlaceholderText('Tolerance class'), 'Class A');
    await user.type(screen.getByPlaceholderText('Parameters'), 'pH buffers');
    await user.type(screen.getByLabelText('Next due date'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() =>
      expect(upsertCalibrationSchedule).toHaveBeenCalledWith('eq-1', expect.objectContaining({ frequencyMonths: 12, parameters: 'pH buffers' })),
    );
  });

  it('EQP-4: QA can verify a PASS record pending verification', async () => {
    const user = userEvent.setup();
    fetchCalibrationRecords.mockResolvedValue([
      { id: 'rec-1', tenantId: 't1', equipmentId: 'eq-1', scheduleId: 'sch-1', performedDate: '2026-01-01T00:00:00.000Z', result: 'pass', certificateFileName: 'c.pdf', certificateContentType: 'application/pdf', toleranceNotes: null, impactAssessmentNote: null, status: 'pending_qa_verification', deviationRef: null, recordedByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    verifyCalibrationRecord.mockResolvedValue({});
    renderPanel(['equipment:approve']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'QA verify' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'QA verify' }));
    expect(screen.getByText('Verified by')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(verifyCalibrationRecord).toHaveBeenCalledWith('eq-1', 'rec-1', 'tok-1'));
  });

  it('EQP-5: QA disposition requires a note before the signature dialog appears', async () => {
    const user = userEvent.setup();
    fetchCalibrationRecords.mockResolvedValue([
      { id: 'rec-2', tenantId: 't1', equipmentId: 'eq-1', scheduleId: 'sch-1', performedDate: '2026-01-01T00:00:00.000Z', result: 'fail', certificateFileName: 'c.pdf', certificateContentType: 'application/pdf', toleranceNotes: null, impactAssessmentNote: 'Drifted out of tolerance.', status: 'pending_qa_verification', deviationRef: null, recordedByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    dispositionCalibrationRecord.mockResolvedValue({});
    renderPanel(['equipment:approve']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'QA disposition' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'QA disposition' }));

    const continueButton = screen.getByRole('button', { name: 'Continue to sign' });
    expect(continueButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Disposition note (required)'), 'Risk assessed as acceptable.');
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(screen.getByText('QA Disposition')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() =>
      expect(dispositionCalibrationRecord).toHaveBeenCalledWith(
        'eq-1',
        'rec-2',
        expect.objectContaining({ outcome: 'release', note: 'Risk assessed as acceptable.', signingToken: 'tok-1' }),
      ),
    );
  });
});
