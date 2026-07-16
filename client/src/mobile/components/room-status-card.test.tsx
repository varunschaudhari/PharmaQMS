import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomStatusCard } from './room-status-card';

const { fetchRoomStatusCard, logRoomCleaning, createRoomCleaningAmendment } = vi.hoisted(() => ({
  fetchRoomStatusCard: vi.fn(),
  logRoomCleaning: vi.fn(),
  createRoomCleaningAmendment: vi.fn(),
}));
vi.mock('../../lib/room-api', () => ({
  fetchRoomStatusCard,
  logRoomCleaning,
  createRoomCleaningAmendment,
}));

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RoomStatusCard roomId="room-1" />
    </QueryClientProvider>,
  );
}

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    roomCode: 'ROOM-001',
    name: 'Granulation Room',
    block: 'Block A',
    classification: 'controlled',
    status: 'active',
    cleaningStatus: 'not_scheduled',
    nextRoutineDueDate: null,
    nextFullDueDate: null,
    lastCleaningEntry: null,
    recentCleaningEntries: [],
    availableActions: ['log_cleaning'],
    ...overrides,
  };
}

describe('QRX-1 RoomStatusCard', () => {
  it('QRX-1: shows NOT SCHEDULED cleaning status and current room status', async () => {
    fetchRoomStatusCard.mockResolvedValue(baseCard());

    renderCard();

    await waitFor(() => expect(screen.getByText('Granulation Room')).toBeInTheDocument());
    expect(screen.getByText('ROOM-001')).toBeInTheDocument();
    expect(screen.getByText('NOT SCHEDULED')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('No cleaning entries yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log Cleaning' })).toBeEnabled();
  });

  it('QRX-1: color-codes an OVERDUE cleaning status', async () => {
    fetchRoomStatusCard.mockResolvedValue(baseCard({ cleaningStatus: 'overdue', nextRoutineDueDate: '2026-06-01T00:00:00.000Z' }));

    renderCard();

    await waitFor(() => expect(screen.getByText('OVERDUE')).toBeInTheDocument());
    expect(screen.getByText('Next routine due 2026-06-01')).toBeInTheDocument();
  });

  it('QRX-1: shows a Retired banner and hides the Log Cleaning action when the room is Retired', async () => {
    fetchRoomStatusCard.mockResolvedValue(baseCard({ status: 'retired', availableActions: [] }));

    renderCard();

    await waitFor(() => expect(screen.getByText(/no further cleaning entries may be logged/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Log Cleaning' })).not.toBeInTheDocument();
  });

  it('QRX-1: logs a cleaning entry by type with optional remarks', async () => {
    const user = userEvent.setup();
    fetchRoomStatusCard.mockResolvedValue(baseCard());
    logRoomCleaning.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log Cleaning' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Log Cleaning' }));
    await user.type(screen.getByPlaceholderText('Remarks (optional)'), 'Floor and surfaces wiped.');
    await user.click(screen.getByRole('button', { name: 'Full' }));

    await waitFor(() => expect(logRoomCleaning).toHaveBeenCalledWith('room-1', 'full', 'Floor and surfaces wiped.'));
  });

  it('QRX-1: a correction logs a NEW amendment entry, never edits the original', async () => {
    const user = userEvent.setup();
    fetchRoomStatusCard.mockResolvedValue(
      baseCard({
        recentCleaningEntries: [
          { id: 'e1', entryType: 'cleaning', cleaningType: 'routine', occurredAt: '2026-07-11T10:00:00.000Z', performedByUserFullName: 'Olive Operator' },
        ],
      }),
    );
    createRoomCleaningAmendment.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct this entry' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Correct this entry' }));
    await user.type(screen.getByPlaceholderText('What was wrong, and what is the correction?'), 'Should have been Full.');
    await user.click(screen.getByRole('button', { name: 'Log correction' }));

    await waitFor(() => expect(createRoomCleaningAmendment).toHaveBeenCalledWith('room-1', 'e1', 'Should have been Full.'));
  });
});
