import type { NotificationData, PaginationMeta, UnreadCountData } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface NotificationsResponse {
  data: NotificationData[];
  meta: PaginationMeta;
}

export async function fetchNotifications(options?: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<NotificationsResponse> {
  const response = await apiClient.get('/notifications', {
    params: {
      page: options?.page ?? 1,
      limit: options?.limit ?? 20,
      unreadOnly: options?.unreadOnly ?? false,
    },
  });
  return response.data;
}

export async function fetchUnreadCount(): Promise<UnreadCountData> {
  const response = await apiClient.get('/notifications/unread-count');
  return response.data.data;
}

export async function markNotificationsRead(
  target: { notificationIds: string[] } | { all: true },
): Promise<{ updated: number }> {
  const response = await apiClient.post('/notifications/mark-read', target);
  return response.data.data;
}
