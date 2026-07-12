// PLT-6: the seam between the notification log (Mongo, always available) and background email
// delivery (BullMQ/Redis, only when jobs are enabled). NotificationsService depends on this
// token, never on BullMQ directly — tests and Redis-less environments bind the no-op.
export interface NotificationJobs {
  // Fire-and-forget by design: a Redis outage must never fail the request that created the
  // notification — the log entry is the durable record, email is best-effort delivery.
  enqueueEmail(notificationId: string): void;
}

export const NOTIFICATION_JOBS = 'PLT6_NOTIFICATION_JOBS';

export const EMAIL_QUEUE = 'plt6-email';
export const DAILY_QUEUE = 'plt6-daily';

export const EMAIL_JOB_SEND = 'send';
export const DAILY_JOB_DUE_DATE_SCAN = 'due-date-scan';
export const DAILY_JOB_DIGEST = 'daily-digest';
