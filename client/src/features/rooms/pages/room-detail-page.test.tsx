import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { RoomDetailPage } from './room-detail-page';

const { fetchRoom, transitionRoomStatus, downloadRoomLabel } = vi.hoisted(() => ({
  fetchRoom: vi.fn(),
  transitionRoomStatus: vi.fn(),
  downloadRoomLabel: vi.fn(),
}));
const { fetchRoomCleaningSchedule, fetchRoomCleaningEntries } = vi.hoisted(() => ({
  fetchRoomCleaningSchedule: vi.fn(),
  fetchRoomCleaningEntries: vi.fn(),
}));
vi.mock('../../../lib/room-api', () => ({
  fetchRoom,
  transitionRoomStatus,
  downloadRoomLabel,
  fetchRoomCleaningSchedule,
  fetchRoomCleaningEntries,
}));

const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/rooms/room-1']}>
          <Routes>
            <Route path="/rooms/:id" element={<RoomDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('QRX-1 RoomDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions: ['rooms:edit'] }));
    fetchRoomCleaningSchedule.mockResolvedValue(null);
    fetchRoomCleaningEntries.mockResolvedValue([]);
  });

  it('QRX-1: shows room metadata, HistoryTab, and transitions status through the allowed map', async () => {
    const user = userEvent.setup();
    fetchRoom.mockResolvedValue({
      id: 'room-1',
      tenantId: 't1',
      roomCode: 'ROOM-001',
      name: 'Granulation Room',
      block: 'Block A',
      classification: 'controlled',
      status: 'active',
      departmentId: 'dept-1',
      qr: { code: 'ABCDE23456', scanUrl: 'http://localhost:5173/s/ABCDE23456' },
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    fetchAuditHistory.mockResolvedValue({
      data: [
        {
          id: 'evt-1', tenantId: 't1', actorId: 'u1', actorName: 'QA Executive',
          entityType: 'Room', entityId: 'room-1', action: 'create', changes: [], reason: null,
          occurredAt: '2026-07-11T00:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
    transitionRoomStatus.mockResolvedValue({ status: 'retired' });

    renderPage();

    await waitFor(() => expect(screen.getByText('Granulation Room')).toBeInTheDocument());
    expect(screen.getByText('ROOM-001 — Active')).toBeInTheDocument();
    expect(await screen.findByText('QA Executive')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Retired' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retired' }));
    await waitFor(() => expect(transitionRoomStatus).toHaveBeenCalledWith('room-1', { status: 'retired', reason: undefined }));

    await user.click(screen.getByRole('button', { name: 'Single label PDF' }));
    expect(downloadRoomLabel).toHaveBeenCalledWith('ABCDE23456', 'single');
  });
});
