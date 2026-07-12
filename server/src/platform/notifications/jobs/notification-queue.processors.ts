import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DueDateScanService } from '../due-date/due-date-scan.service';
import { EmailDeliveryService } from '../email-delivery.service';
import {
  DAILY_JOB_DIGEST,
  DAILY_JOB_DUE_DATE_SCAN,
  DAILY_QUEUE,
  EMAIL_JOB_SEND,
  EMAIL_QUEUE,
} from './notification-jobs.interface';

// PLT-6: thin shells — all logic lives in the services (which the test suite exercises
// directly, without Redis).

@Processor(EMAIL_QUEUE)
export class EmailQueueProcessor extends WorkerHost {
  constructor(private readonly emailDelivery: EmailDeliveryService) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    if (job.name === EMAIL_JOB_SEND) {
      await this.emailDelivery.sendForNotification(job.data.notificationId);
    }
  }
}

@Processor(DAILY_QUEUE)
export class DailyQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(DailyQueueProcessor.name);

  constructor(
    private readonly dueDateScanService: DueDateScanService,
    private readonly emailDelivery: EmailDeliveryService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === DAILY_JOB_DUE_DATE_SCAN) {
      await this.dueDateScanService.runDailyScan();
    } else if (job.name === DAILY_JOB_DIGEST) {
      const sent = await this.emailDelivery.sendDailyDigests();
      this.logger.log(`Daily digest job: ${sent} digest email(s) sent.`);
    }
  }
}
