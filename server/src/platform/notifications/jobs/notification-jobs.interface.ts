// PLT-6: the seam between the notification log (Mongo, always available) and background email/
// WhatsApp delivery (BullMQ/Redis, only when jobs are enabled). NotificationsService depends on
// this token, never on BullMQ directly — tests and Redis-less environments bind the no-op.
export interface NotificationJobs {
  // Fire-and-forget by design: a Redis outage must never fail the request that created the
  // notification — the log entry is the durable record, email is best-effort delivery.
  enqueueEmail(notificationId: string): void;
  // PLT-6-WA: same fire-and-forget contract as enqueueEmail. Retry/backoff and rate limiting are
  // configured on the job/worker (see BullNotificationJobs.enqueueWhatsApp /
  // WhatsAppQueueProcessor), not here.
  enqueueWhatsApp(notificationId: string): void;
}

export const NOTIFICATION_JOBS = 'PLT6_NOTIFICATION_JOBS';

export const EMAIL_QUEUE = 'plt6-email';
export const DAILY_QUEUE = 'plt6-daily';
export const WHATSAPP_QUEUE = 'plt6-whatsapp';

export const EMAIL_JOB_SEND = 'send';
export const DAILY_JOB_DUE_DATE_SCAN = 'due-date-scan';
export const DAILY_JOB_DIGEST = 'daily-digest';
export const WHATSAPP_JOB_SEND = 'send';
