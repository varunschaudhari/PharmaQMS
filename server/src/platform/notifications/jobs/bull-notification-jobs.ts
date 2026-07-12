import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { notificationsConfig, type NotificationsConfig } from '../config/notifications.config';
import {
  DAILY_JOB_DIGEST,
  DAILY_JOB_DUE_DATE_SCAN,
  DAILY_QUEUE,
  EMAIL_JOB_SEND,
  EMAIL_QUEUE,
  type NotificationJobs,
} from './notification-jobs.interface';

// PLT-6: the BullMQ-backed implementation — enqueues immediate emails and schedules the two
// repeatable daily jobs (due-date scan + digest). Everything here is fire-and-forget with error
// logging: Redis being down degrades email delivery, never request handling or app boot.
@Injectable()
export class BullNotificationJobs implements NotificationJobs, OnApplicationBootstrap {
  private readonly logger = new Logger(BullNotificationJobs.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(DAILY_QUEUE) private readonly dailyQueue: Queue,
    @Inject(notificationsConfig.KEY) private readonly config: NotificationsConfig,
  ) {}

  enqueueEmail(notificationId: string): void {
    void this.emailQueue
      .add(EMAIL_JOB_SEND, { notificationId }, { removeOnComplete: true, attempts: 3 })
      .catch((error: unknown) => {
        this.logger.error(`Failed to enqueue email for notification ${notificationId}`, String(error));
      });
  }

  onApplicationBootstrap(): void {
    // Repeatable jobs are upserted by their repeat pattern — re-registering on every boot is a
    // no-op, not a duplicate schedule.
    void this.dailyQueue
      .add(DAILY_JOB_DUE_DATE_SCAN, {}, { repeat: { pattern: this.config.dueDateScanCron }, removeOnComplete: true })
      .catch((error: unknown) => this.logger.error('Failed to schedule the daily due-date scan', String(error)));
    void this.dailyQueue
      .add(DAILY_JOB_DIGEST, {}, { repeat: { pattern: this.config.digestCron }, removeOnComplete: true })
      .catch((error: unknown) => this.logger.error('Failed to schedule the daily digest', String(error)));
  }
}
