import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalibrationAgencyDetailPage } from './calibration-agency-detail-page';

const {
  fetchCalibrationAgency,
  updateCalibrationAgency,
  transitionCalibrationAgencyStatus,
  uploadCalibrationAgencyCertificate,
  openCalibrationAgencyCertificate,
} = vi.hoisted(() => ({
  fetchCalibrationAgency: vi.fn(),
  updateCalibrationAgency: vi.fn(),
  transitionCalibrationAgencyStatus: vi.fn(),
  uploadCalibrationAgencyCertificate: vi.fn(),
  openCalibrationAgencyCertificate: vi.fn(),
}));
vi.mock('../../../lib/calibration-agency-api', () => ({
  fetchCalibrationAgency,
  updateCalibrationAgency,
  transitionCalibrationAgencyStatus,
  uploadCalibrationAgencyCertificate,
  openCalibrationAgencyCertificate,
}));

const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/equipment/calibration-agencies/agency-1']}>
        <Routes>
          <Route path="/equipment/calibration-agencies/:id" element={<CalibrationAgencyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EQP-11 CalibrationAgencyDetailPage', () => {
  it('EQP-11: shows an expired-accreditation warning and suspends the agency', async () => {
    const user = userEvent.setup();
    fetchCalibrationAgency.mockResolvedValue({
      id: 'agency-1',
      tenantId: 't1',
      name: 'Lapsed Cal Co',
      contactName: 'Rita Rao',
      contactEmail: null,
      contactPhone: null,
      accreditationNumber: 'NABL-999',
      accreditationValidUntil: '2020-01-01T00:00:00.000Z',
      status: 'active',
      certificates: [],
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    fetchAuditHistory.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    transitionCalibrationAgencyStatus.mockResolvedValue({});

    renderPage();

    await waitFor(() => expect(screen.getByText('Lapsed Cal Co')).toBeInTheDocument());
    expect(screen.getByText(/Accreditation expired 2020-01-01/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(transitionCalibrationAgencyStatus).toHaveBeenCalledWith('agency-1', 'suspended'));
  });

  it('EQP-11: uploads an accreditation certificate', async () => {
    const user = userEvent.setup();
    fetchCalibrationAgency.mockResolvedValue({
      id: 'agency-1',
      tenantId: 't1',
      name: 'Cal-Labs Inc',
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      accreditationNumber: null,
      accreditationValidUntil: null,
      status: 'active',
      certificates: [],
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    fetchAuditHistory.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    uploadCalibrationAgencyCertificate.mockResolvedValue({});

    renderPage();
    await waitFor(() => expect(screen.getByText('Cal-Labs Inc')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();

    const file = new File(['%PDF-1.4'], 'nabl-cert.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.click(screen.getByRole('button', { name: 'Upload certificate' }));

    await waitFor(() => expect(uploadCalibrationAgencyCertificate).toHaveBeenCalledWith('agency-1', file));
  });
});
