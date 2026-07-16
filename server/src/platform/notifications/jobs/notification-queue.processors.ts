import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DueDateScanService } from '../due-date/due-date-scan.service';
import { EmailDeliveryService } from '../email-delivery.service';
import { WhatsAppDeliveryService } from '../whatsapp-delivery.service';
import {
  DAILY_JOB_DIGEST,
  DAILY_JOB_DUE_DATE_SCAN,
  DAILY_QUEUE,
  EMAIL_JOB_SEND,
  EMAIL_QUEUE,
  WHATSAPP_JOB_SEND,
  WHATSAPP_QUEUE,
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

// PLT-6-WA: rate-limited per SPEC's ask — a shared WhatsApp Business phone number has a
// per-second throughput ceiling on Meta's side, so the WORKER (not just the queue) caps how fast
// jobs are processed. Read directly from process.env (not the ConfigService) because @Processor's
// options are decorator metadata evaluated at class-definition time, before Nest's DI container
// exists — the same constraint that applies to any other decorator-level configuration.
@Processor(WHATSAPP_QUEUE, { limiter: { max: Number(process.env.WHATSAPP_RATE_LIMIT_PER_SECOND ?? 20), duration: 1000 } })
export class WhatsAppQueueProcessor extends WorkerHost {
  constructor(private readonly whatsappDelivery: WhatsAppDeliveryService) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    if (job.name === WHATSAPP_JOB_SEND) {
      await this.whatsappDelivery.sendForNotification(job.data.notificationId);
    }
  }
}
