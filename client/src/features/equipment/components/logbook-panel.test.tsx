import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LogbookPanel } from './logbook-panel';

const { fetchLogbook, createLogbookAmendment, openLogbookPhoto } = vi.hoisted(() => ({
  fetchLogbook: vi.fn(),
  createLogbookAmendment: vi.fn(),
  openLogbookPhoto: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({ fetchLogbook, createLogbookAmendment, openLogbookPhoto }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LogbookPanel equipmentId="eq-1" />
    </QueryClientProvider>,
  );
}

describe('EQP-6 LogbookPanel', () => {
  it('EQP-6: lists logbook entries with photo/correction actions', async () => {
    fetchLogbook.mockResolvedValue([
      { id: 'e1', tenantId: 't1', equipmentId: 'eq-1', entryType: 'breakdown', productBatchRef: null, cleaningType: null, description: 'Pump seal leaking.', photoFileName: 'photo.jpg', photoContentType: 'image/jpeg', amendsEntryId: null, performedByUserId: 'u1', performedByUserFullName: 'Olive Operator', occurredAt: '2026-07-11T10:00:00.000Z' },
    ]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('Breakdown reported')).toBeInTheDocument());
    expect(screen.getByText('Pump seal leaking.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View photo' })).toBeInTheDocument();
  });

  it('EQP-6: logs a correction as a new amendment, never editing the original', async () => {
    const user = userEvent.setup();
    fetchLogbook.mockResolvedValue([
      { id: 'e1', tenantId: 't1', equipmentId: 'eq-1', entryType: 'cleaning', productBatchRef: null, cleaningType: 'routine', description: null, photoFileName: null, photoContentType: null, amendsEntryId: null, performedByUserId: 'u1', performedByUserFullName: 'Olive Operator', occurredAt: '2026-07-11T10:00:00.000Z' },
    ]);
    createLogbookAmendment.mockResolvedValue({});

    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct this entry' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Correct this entry' }));
    await user.type(screen.getByPlaceholderText('What was wrong, and what is the correction?'), 'Should have been Full.');
    await user.click(screen.getByRole('button', { name: 'Log correction' }));

    await waitFor(() => expect(createLogbookAmendment).toHaveBeenCalledWith('eq-1', 'e1', 'Should have been Full.'));
  });

  it('EQP-6: shows an empty state when there are no entries', async () => {
    fetchLogbook.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('No logbook entries yet.')).toBeInTheDocument());
  });
});
