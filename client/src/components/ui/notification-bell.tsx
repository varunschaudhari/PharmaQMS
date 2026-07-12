import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchNotifications, fetchUnreadCount, markNotificationsRead } from '../../lib/notifications-api';

const UNREAD_POLL_INTERVAL_MS = 30_000;

// PLT-6: the notification bell — unread badge + dropdown list of unread notifications with a
// mark-all-read action. Lives in the desktop shell header on every page.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: unreadData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
  });
  const unread = unreadData?.unread ?? 0;

  const { data: unreadList } = useQuery({
    queryKey: ['notifications-unread-list'],
    queryFn: () => fetchNotifications({ unreadOnly: true, limit: 10 }),
    enabled: open,
  });

  const markAllRead = useMutation({
    mutationFn: () => markNotificationsRead({ all: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-list'] });
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen((current) => !current)}
        className="relative rounded p-1.5 text-slate-600 hover:bg-slate-100"
      >
        {/* Bell glyph — keeping the shell dependency-free (no icon library). */}
        <span aria-hidden="true" className="text-lg leading-none">
          🔔
        </span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            <button
              type="button"
              disabled={unread === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              className="text-xs text-slate-500 underline disabled:no-underline disabled:opacity-50"
            >
              Mark all read
            </button>
          </div>

          {(unreadList?.data ?? []).length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No unread notifications.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {(unreadList?.data ?? []).map((notification) => (
                <li key={notification.id} className="px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{notification.body}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
