import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './notification-bell';

const { fetchNotifications, fetchUnreadCount, markNotificationsRead } = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock('../../lib/notifications-api', () => ({
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
}));

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

describe('PLT-6 NotificationBell', () => {
  it('PLT-6: shows the unread count badge and lists unread notifications when opened', async () => {
    const user = userEvent.setup();
    fetchUnreadCount.mockResolvedValue({ unread: 2 });
    fetchNotifications.mockResolvedValue({
      data: [
        {
          id: 'n1',
          tenantId: 't1',
          userId: 'u1',
          event: 'task_assigned',
          entityType: 'Document',
          entityId: 'SOP-QA-001',
          title: 'Approval task: Document SOP-QA-001',
          body: 'Awaiting your review at step "Dept Head Review".',
          dedupeKey: null,
          isRead: false,
          emailedAt: null,
          createdAt: '2026-07-11T06:30:00.000Z',
        },
        {
          id: 'n2',
          tenantId: 't1',
          userId: 'u1',
          event: 'overdue',
          entityType: 'Equipment',
          entityId: 'EQP-0042',
          title: 'Calibration overdue: EQP-0042',
          body: 'EQP-0042 calibration was due 2026-07-01.',
          dedupeKey: 'overdue:Equipment:EQP-0042:calibration:2026-07-01',
          isRead: false,
          emailedAt: null,
          createdAt: '2026-07-11T01:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 10, total: 2 },
    });

    renderBell();

    const bellButton = await screen.findByRole('button', { name: /notifications \(2 unread\)/i });
    expect(bellButton).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    await user.click(bellButton);

    await waitFor(() => expect(screen.getByText('Approval task: Document SOP-QA-001')).toBeInTheDocument());
    expect(screen.getByText('Calibration overdue: EQP-0042')).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledWith({ unreadOnly: true, limit: 10 });
  });

  it('PLT-6: mark-all-read calls the API and refreshes the badge', async () => {
    const user = userEvent.setup();
    fetchUnreadCount.mockResolvedValueOnce({ unread: 1 }).mockResolvedValue({ unread: 0 });
    fetchNotifications.mockResolvedValue({
      data: [
        {
          id: 'n1',
          tenantId: 't1',
          userId: 'u1',
          event: 'rejected',
          entityType: 'Document',
          entityId: 'SOP-QA-002',
          title: 'Rejected: Document SOP-QA-002',
          body: 'Rejected by QA Head. Reason: missing annexure.',
          dedupeKey: null,
          isRead: false,
          emailedAt: null,
          createdAt: '2026-07-11T05:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 10, total: 1 },
    });
    markNotificationsRead.mockResolvedValue({ updated: 1 });

    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications \(1 unread\)/i }));
    await user.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith({ all: true }));
  });
});
