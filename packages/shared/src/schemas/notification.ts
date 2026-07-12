import { z } from 'zod';

// PLT-6: query for GET /notifications (the bell's unread list + paginated history).
export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .union([z.boolean(), z.string()])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

// PLT-6: mark one or all notifications read. Reading is the ONLY mutation a notification
// supports — no edits, no deletes.
export const markNotificationsReadRequestSchema = z.union([
  z.object({ notificationIds: z.array(z.string().min(1)).min(1) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>;
