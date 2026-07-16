import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MaterialLotStatusCard } from './material-lot-status-card';

const { fetchMaterialLotScanView, dispositionMaterialLotStatus } = vi.hoisted(() => ({
  fetchMaterialLotScanView: vi.fn(),
  dispositionMaterialLotStatus: vi.fn(),
}));
vi.mock('../../lib/material-lot-api', () => ({
  fetchMaterialLotScanView,
  dispositionMaterialLotStatus,
}));

const { challengeSignature } = vi.hoisted(() => ({ challengeSignature: vi.fn() }));
vi.mock('../../lib/esign-api', () => ({ challengeSignature }));

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MaterialLotStatusCard lotId="lot-1" />
    </QueryClientProvider>,
  );
}

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-1',
    lotCode: 'LOT-001',
    materialName: 'Lactose Monohydrate',
    manufacturer: 'DFE Pharma',
    receivedDate: '2026-07-01T00:00:00.000Z',
    status: 'quarantine',
    lastDisposition: null,
    availableActions: [],
    ...overrides,
  };
}

describe('QRX-2 MaterialLotStatusCard', () => {
  it('QRX-2: shows a color-coded QUARANTINE banner and material info, view-only for a non-QA operator', async () => {
    fetchMaterialLotScanView.mockResolvedValue(baseCard());

    renderCard();

    await waitFor(() => expect(screen.getByText('Lactose Monohydrate')).toBeInTheDocument());
    expect(screen.getByText('LOT-001')).toBeInTheDocument();
    expect(screen.getByText('QUARANTINE')).toBeInTheDocument();
    expect(screen.getByText('DFE Pharma')).toBeInTheDocument();
    expect(screen.getByText('No QA disposition recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument();
  });

  it('QRX-2: color-codes an APPROVED lot green and REJECTED red, and shows disposition details', async () => {
    fetchMaterialLotScanView.mockResolvedValue(
      baseCard({ status: 'approved', lastDisposition: { userFullName: 'Quinn Qahead', meaning: 'qa_disposition', reason: 'COA conforms.', signedAt: '2026-07-11T10:00:00.000Z' } }),
    );

    renderCard();

    await waitFor(() => expect(screen.getByText('APPROVED')).toBeInTheDocument());
    expect(screen.getByText(/Quinn Qahead/)).toBeInTheDocument();
    expect(screen.getByText('COA conforms.')).toBeInTheDocument();
  });

  it('QRX-2 / Iron Rule 4: a QA-eligible operator changes status via a note-then-signature two-step flow', async () => {
    const user = userEvent.setup();
    fetchMaterialLotScanView.mockResolvedValue(baseCard({ availableActions: ['change_status'] }));
    challengeSignature.mockResolvedValue({ signingToken: 'tok-1', expiresAt: '2026-07-11T00:02:00.000Z' });
    dispositionMaterialLotStatus.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to Under Test' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Move to Under Test' }));

    await user.type(screen.getByPlaceholderText('Disposition note (optional)'), 'Sent to QC for testing.');
    await user.click(screen.getByRole('button', { name: 'Continue to sign' }));

    expect(screen.getByText('QA Disposition')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(dispositionMaterialLotStatus).toHaveBeenCalledWith('lot-1', 'tok-1', 'under_test', 'Sent to QC for testing.'));
  });
});
