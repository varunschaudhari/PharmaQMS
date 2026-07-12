import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TestRecordDetailPage } from './test-record-detail-page';

const { fetchTestRecord, updateTestRecord, downloadQrLabel } = vi.hoisted(() => ({
  fetchTestRecord: vi.fn(),
  updateTestRecord: vi.fn(),
  downloadQrLabel: vi.fn(),
}));
const { submitWorkflow } = vi.hoisted(() => ({ submitWorkflow: vi.fn() }));
const { fetchSignatures } = vi.hoisted(() => ({ fetchSignatures: vi.fn() }));
const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));

vi.mock('../../../lib/test-record-api', () => ({ fetchTestRecord, updateTestRecord, downloadQrLabel }));
vi.mock('../../../lib/workflow-api', () => ({ submitWorkflow }));
vi.mock('../../../lib/esign-api', () => ({ fetchSignatures }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/test-records/rec-1']}>
        <Routes>
          <Route path="/test-records/:id" element={<TestRecordDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Phase 0 gate — TestRecordDetailPage', () => {
  it('PLT-2 PLT-3 PLT-4 PLT-5 PLT-7: shows number, signatures, history, QR block, and submits for approval', async () => {
    const user = userEvent.setup();
    fetchTestRecord.mockResolvedValue({
      id: 'rec-1',
      tenantId: 't1',
      recordNumber: 'TR-0001',
      title: 'Dummy record',
      description: 'Phase 0 demo.',
      createdAt: '2026-07-11T10:00:00.000Z',
      workflow: null,
      qr: { code: 'ABCDE23456', scanUrl: 'http://localhost:5173/s/ABCDE23456' },
    });
    fetchSignatures.mockResolvedValue([
      {
        id: 'sig-1',
        tenantId: 't1',
        userId: 'u1',
        userFullName: 'Quinn Qahead',
        meaning: 'approved_by',
        entityType: 'TestRecord',
        entityId: 'rec-1',
        snapshotHash: 'abc',
        reason: null,
        signedAt: '2026-07-11T11:00:00.000Z',
      },
    ]);
    fetchAuditHistory.mockResolvedValue({
      data: [
        {
          id: 'evt-1',
          tenantId: 't1',
          actorId: 'u1',
          actorName: 'Gate Admin',
          entityType: 'TestRecord',
          entityId: 'rec-1',
          action: 'create',
          changes: [],
          reason: null,
          occurredAt: '2026-07-11T10:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
    submitWorkflow.mockResolvedValue({ id: 'wf-1' });

    renderPage();

    await waitFor(() => expect(screen.getByText('TR-0001 — Dummy record')).toBeInTheDocument());
    expect(await screen.findByText('Quinn Qahead')).toBeInTheDocument();
    expect(await screen.findByText('Gate Admin')).toBeInTheDocument();
    expect(await screen.findByText('ABCDE23456')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));
    await waitFor(() =>
      expect(submitWorkflow).toHaveBeenCalledWith({ entityType: 'TestRecord', entityId: 'rec-1' }),
    );
  });
});
