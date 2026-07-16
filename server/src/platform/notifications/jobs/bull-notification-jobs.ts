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
  WHATSAPP_JOB_SEND,
  WHATSAPP_QUEUE,
  type NotificationJobs,
} from './notification-jobs.interface';

// PLT-6: the BullMQ-backed implementation — enqueues immediate emails/WhatsApp sends and
// schedules the two repeatable daily jobs (due-date scan + digest). Everything here is
// fire-and-forget with error logging: Redis being down degrades delivery, never request handling
// or app boot.
@Injectable()
export class BullNotificationJobs implements NotificationJobs, OnApplicationBootstrap {
  private readonly logger = new Logger(BullNotificationJobs.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(DAILY_QUEUE) private readonly dailyQueue: Queue,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue,
    @Inject(notificationsConfig.KEY) private readonly config: NotificationsConfig,
  ) {}

  enqueueEmail(notificationId: string): void {
    void this.emailQueue
      .add(EMAIL_JOB_SEND, { notificationId }, { removeOnComplete: true, attempts: 3 })
      .catch((error: unknown) => {
        this.logger.error(`Failed to enqueue email for notification ${notificationId}`, String(error));
      });
  }

  // PLT-6-WA: retry with exponential backoff — a real, paid-per-message HTTP call to Meta can
  // fail transiently (rate limit, network blip) in ways plain console/file email delivery never
  // does, so unlike enqueueEmail this is worth retrying several times before giving up.
  enqueueWhatsApp(notificationId: string): void {
    void this.whatsappQueue
      .add(
        WHATSAPP_JOB_SEND,
        { notificationId },
        { removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      )
      .catch((error: unknown) => {
        this.logger.error(`Failed to enqueue WhatsApp send for notification ${notificationId}`, String(error));
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
