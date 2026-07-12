import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { QualificationPanel } from './qualification-panel';

const { fetchQualificationRecords, recordQualification, attachQualificationReport, openQualificationFile } = vi.hoisted(() => ({
  fetchQualificationRecords: vi.fn(),
  recordQualification: vi.fn(),
  attachQualificationReport: vi.fn(),
  openQualificationFile: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({
  fetchQualificationRecords,
  recordQualification,
  attachQualificationReport,
  openQualificationFile,
}));

function renderPanel(permissions: string[]) {
  localStorage.clear();
  localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <QualificationPanel equipmentId="eq-1" />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('EQP-8 QualificationPanel', () => {
  it('EQP-8: an operator with no equipment:edit sees records read-only (no record form)', async () => {
    fetchQualificationRecords.mockResolvedValue([
      { id: 'r1', tenantId: 't1', equipmentId: 'eq-1', qualificationType: 'iq', performedDate: '2026-01-01T00:00:00.000Z', result: 'pass', protocolFileName: 'p.pdf', protocolContentType: 'application/pdf', reportFileName: null, reportContentType: null, notes: null, requalificationFrequencyMonths: null, recordedByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    renderPanel([]);

    await waitFor(() => expect(screen.getByText('iq')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Record qualification' })).not.toBeInTheDocument();
  });

  it('EQP-8: an engineer records a qualification event (protocol only)', async () => {
    const user = userEvent.setup();
    fetchQualificationRecords.mockResolvedValue([]);
    recordQualification.mockResolvedValue({});
    renderPanel(['equipment:edit']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Record qualification' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Performed date'), '2026-01-01');
    const protocolFile = new File(['protocol'], 'protocol.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Protocol (required)'), protocolFile);
    await user.click(screen.getByRole('button', { name: 'Record qualification' }));

    await waitFor(() =>
      expect(recordQualification).toHaveBeenCalledWith('eq-1', expect.objectContaining({ performedDate: '2026-01-01', protocol: protocolFile })),
    );
  });

  it('EQP-8: attaches a report to a record missing one', async () => {
    const user = userEvent.setup();
    fetchQualificationRecords.mockResolvedValue([
      { id: 'r1', tenantId: 't1', equipmentId: 'eq-1', qualificationType: 'pq', performedDate: '2026-01-01T00:00:00.000Z', result: 'pass', protocolFileName: 'p.pdf', protocolContentType: 'application/pdf', reportFileName: null, reportContentType: null, notes: null, requalificationFrequencyMonths: 24, recordedByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    attachQualificationReport.mockResolvedValue({});
    renderPanel(['equipment:edit']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Attach report' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Attach report' }));
    const reportFile = new File(['report'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Report file'), reportFile);
    await user.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(attachQualificationReport).toHaveBeenCalledWith('eq-1', 'r1', reportFile));
  });
});
