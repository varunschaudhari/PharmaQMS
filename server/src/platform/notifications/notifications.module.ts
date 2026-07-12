import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { Tenant, TenantSchema } from '../tenant/schemas/tenant.schema';
import {
  jobsEnabled,
  notificationsConfig,
  redisConnectionOptions,
  type NotificationsConfig,
} from './config/notifications.config';
import { DueDateScanService } from './due-date/due-date-scan.service';
import { DueDateScannerRegistry } from './due-date/due-date-scanner.registry';
import { EmailDeliveryService } from './email-delivery.service';
import { BullNotificationJobs } from './jobs/bull-notification-jobs';
import { NoopNotificationJobs } from './jobs/noop-notification-jobs';
import { DAILY_QUEUE, EMAIL_QUEUE, NOTIFICATION_JOBS } from './jobs/notification-jobs.interface';
import { DailyQueueProcessor, EmailQueueProcessor } from './jobs/notification-queue.processors';
import { ConsoleMailer } from './mailer/console-mailer';
import { FileMailer } from './mailer/file-mailer';
import { MAILER } from './mailer/mailer.interface';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DueDateScanRun, DueDateScanRunSchema } from './schemas/due-date-scan-run.schema';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { WorkflowNotificationListener } from './workflow-notification.listener';

// PLT-6: composed dynamically so BullMQ (and therefore Redis) is only wired when jobs are
// enabled. Tests run with JOBS_ENABLED=false (test/jest-setup-env.ts) and exercise the services
// directly; dev/prod get queues, workers, and the repeatable daily jobs.
@Module({})
export class NotificationsModule {
  static forRoot(): DynamicModule {
    const enabled = jobsEnabled();

    const bullImports = enabled
      ? [
          BullModule.forRoot({ connection: redisConnectionOptions() }),
          BullModule.registerQueue({ name: EMAIL_QUEUE }, { name: DAILY_QUEUE }),
        ]
      : [];

    const jobProviders: Provider[] = enabled
      ? [
          BullNotificationJobs,
          { provide: NOTIFICATION_JOBS, useExisting: BullNotificationJobs },
          EmailQueueProcessor,
          DailyQueueProcessor,
        ]
      : [{ provide: NOTIFICATION_JOBS, useClass: NoopNotificationJobs }];

    return {
      module: NotificationsModule,
      // Global so business modules can inject DueDateScannerRegistry/NotificationsService
      // without re-importing this dynamic module (re-running forRoot would re-register BullMQ).
      global: true,
      imports: [
        ConfigModule.forFeature(notificationsConfig),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
          { name: DueDateScanRun.name, schema: DueDateScanRunSchema },
          // User/Tenant re-registered (not imported from their modules) to keep platform modules
          // independent of one another; Mongoose dedupes model registration per connection.
          { name: User.name, schema: UserSchema },
          { name: Tenant.name, schema: TenantSchema },
        ]),
        // PLT-2: notification creation and mark-read are audited.
        AuditModule,
        ...bullImports,
      ],
      controllers: [NotificationsController],
      providers: [
        {
          provide: MAILER,
          inject: [notificationsConfig.KEY],
          useFactory: (config: NotificationsConfig) =>
            config.mailTransport === 'file' ? new FileMailer(config.mailOutboxPath) : new ConsoleMailer(),
        },
        NotificationsService,
        EmailDeliveryService,
        WorkflowNotificationListener,
        DueDateScannerRegistry,
        DueDateScanService,
        ...jobProviders,
      ],
      exports: [NotificationsService, DueDateScannerRegistry, DueDateScanService, EmailDeliveryService],
    };
  }
}
