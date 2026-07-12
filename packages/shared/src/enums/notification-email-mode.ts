// PLT-6: per-tenant email delivery mode — send each notification email immediately, or batch
// everything unsent into a daily digest per user.
export enum NotificationEmailMode {
  IMMEDIATE = 'immediate',
  DAILY_DIGEST = 'daily_digest',
}
