import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { MaterialLotDetailPage } from './material-lot-detail-page';

const { fetchMaterialLot, dispositionMaterialLotStatus, downloadMaterialLotLabel } = vi.hoisted(() => ({
  fetchMaterialLot: vi.fn(),
  dispositionMaterialLotStatus: vi.fn(),
  downloadMaterialLotLabel: vi.fn(),
}));
vi.mock('../../../lib/material-lot-api', () => ({
  fetchMaterialLot,
  dispositionMaterialLotStatus,
  downloadMaterialLotLabel,
}));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../../lib/esign-api', () => ({ challengeSignature }));

const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/materials/lot-1']}>
          <Routes>
            <Route path="/materials/:id" element={<MaterialLotDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('QRX-2 MaterialLotDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchAuditHistory.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
  });

  it('QRX-2: a QA user sees status-change buttons and completes a note-then-signature disposition', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions: ['materials:approve'] }));
    const user = userEvent.setup();
    fetchMaterialLot.mockResolvedValue({
      id: 'lot-1',
      tenantId: 't1',
      lotCode: 'LOT-001',
      materialName: 'Lactose Monohydrate',
      manufacturer: 'DFE Pharma',
      receivedDate: '2026-07-01T00:00:00.000Z',
      status: 'quarantine',
      qr: { code: 'ABCDE23456', scanUrl: 'http://localhost:5173/s/ABCDE23456' },
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    challengeSignature.mockResolvedValue({ signingToken: 'tok-1', expiresAt: '2026-07-11T00:02:00.000Z' });
    dispositionMaterialLotStatus.mockResolvedValue({});

    renderPage();

    await waitFor(() => expect(screen.getByText('Lactose Monohydrate')).toBeInTheDocument());
    expect(screen.getByText('LOT-001 — Quarantine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Under Test' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to Under Test' }));
    await user.click(screen.getByRole('button', { name: 'Continue to sign' }));
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(dispositionMaterialLotStatus).toHaveBeenCalledWith('lot-1', 'tok-1', 'under_test', undefined));

    await user.click(screen.getByRole('button', { name: 'Single label PDF' }));
    expect(downloadMaterialLotLabel).toHaveBeenCalledWith('ABCDE23456', 'single');
  });

  it('QRX-2: a non-QA user does not see status-change buttons', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions: [] }));
    fetchMaterialLot.mockResolvedValue({
      id: 'lot-1',
      tenantId: 't1',
      lotCode: 'LOT-001',
      materialName: 'Lactose Monohydrate',
      manufacturer: 'DFE Pharma',
      receivedDate: '2026-07-01T00:00:00.000Z',
      status: 'quarantine',
      qr: { code: 'ABCDE23456', scanUrl: 'http://localhost:5173/s/ABCDE23456' },
      createdAt: '2026-07-11T00:00:00.000Z',
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Lactose Monohydrate')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument();
  });
});
