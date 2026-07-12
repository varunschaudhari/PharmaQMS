import { registerAs } from '@nestjs/config';

export type MailTransportKind = 'console' | 'file';

export interface NotificationsConfig {
  mailTransport: MailTransportKind;
  // Only used by the file transport.
  mailOutboxPath: string;
  // Daily cron (server time / UTC) for the due-date scan and the digest jobs. Per-tenant
  // *dating* of the scan uses the tenant timezone (see DueDateScanService.runDateFor); the cron
  // itself is platform-level.
  dueDateScanCron: string;
  digestCron: string;
}

export const notificationsConfig = registerAs<NotificationsConfig>('notifications', () => ({
  mailTransport: process.env.MAIL_TRANSPORT === 'file' ? 'file' : 'console',
  mailOutboxPath: process.env.MAIL_OUTBOX_PATH ?? 'mail-outbox.ndjson',
  // 01:00 UTC = 06:30 IST — before the plant's working day starts.
  dueDateScanCron: process.env.JOBS_DUE_DATE_SCAN_CRON ?? '0 1 * * *',
  digestCron: process.env.JOBS_DIGEST_CRON ?? '30 1 * * *',
}));

// PLT-6: BullMQ (Redis) is required for jobs in dev/prod, but tests run with JOBS_ENABLED=false
// (see test/jest-setup-env.ts) so the suite never needs a Redis instance — the job processors
// are thin shells over services that are tested directly.
export function jobsEnabled(): boolean {
  return process.env.JOBS_ENABLED !== 'false';
}

export function redisConnectionOptions(): { host: string; port: number; maxRetriesPerRequest: null } {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    // Required by BullMQ workers; harmless for queues.
    maxRetriesPerRequest: null,
  };
}
