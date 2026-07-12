import { Injectable, Logger } from '@nestjs/common';
import type { NotificationJobs } from './notification-jobs.interface';

// PLT-6: bound when JOBS_ENABLED=false (tests, Redis-less environments). The notification log
// itself is unaffected — only background email delivery is off.
@Injectable()
export class NoopNotificationJobs implements NotificationJobs {
  private readonly logger = new Logger(NoopNotificationJobs.name);

  enqueueEmail(notificationId: string): void {
    this.logger.debug(`Jobs disabled — skipping email enqueue for notification ${notificationId}`);
  }
}
