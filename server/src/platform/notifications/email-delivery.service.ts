import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NotificationEmailMode } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { Tenant, TenantDocument } from '../tenant/schemas/tenant.schema';
import { MAILER, type Mailer } from './mailer/mailer.interface';
import { Notification, NotificationDocument } from './schemas/notification.schema';

const MAIL_FOOTER = '\n\n— PharmaQMS. Log in to view details and take action.';

// PLT-6: renders notification-log entries into mail via the provider-agnostic Mailer. Runs from
// BullMQ workers (never in a request path). Both entry points are idempotent — an already-
// emailed notification is never sent twice, so job retries are safe.
@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  // Immediate mode: one email per notification, enqueued at creation time.
  async sendForNotification(notificationId: string): Promise<void> {
    const notification = await this.notificationModel.findById(notificationId);
    if (!notification || notification.emailedAt) {
      return;
    }
    const user = await this.userModel.findOne({ _id: notification.userId, tenantId: notification.tenantId });
    if (!user) {
      this.logger.warn(`Notification ${notificationId}: recipient user not found — skipping email.`);
      return;
    }

    await this.mailer.send({
      to: user.email,
      subject: notification.title,
      text: notification.body + MAIL_FOOTER,
    });

    notification.emailedAt = new Date();
    await notification.save();
  }

  // Digest mode: one email per user per day, batching everything not yet emailed. Returns the
  // number of digest emails sent.
  async sendDailyDigests(now: Date = new Date()): Promise<number> {
    const digestTenants = await this.tenantModel.find({
      isActive: true,
      'settings.notificationEmailMode': NotificationEmailMode.DAILY_DIGEST,
    });

    let digestsSent = 0;
    for (const tenant of digestTenants) {
      const unsent = await this.notificationModel
        .find({ tenantId: tenant._id, emailedAt: null })
        .sort({ createdAt: 1 });
      if (unsent.length === 0) {
        continue;
      }

      const byUser = new Map<string, NotificationDocument[]>();
      for (const notification of unsent) {
        const key = notification.userId.toString();
        const list = byUser.get(key) ?? [];
        list.push(notification);
        byUser.set(key, list);
      }

      for (const [userId, notifications] of byUser) {
        const user = await this.userModel.findOne({ _id: userId, tenantId: tenant._id });
        if (!user) {
          this.logger.warn(`Digest: user ${userId} not found in tenant ${tenant._id.toString()} — skipping.`);
          continue;
        }

        const lines = notifications.map((n) => `• ${n.title}\n  ${n.body}`);
        await this.mailer.send({
          to: user.email,
          subject: `PharmaQMS daily digest — ${notifications.length} update${notifications.length === 1 ? '' : 's'}`,
          text: lines.join('\n\n') + MAIL_FOOTER,
        });

        await this.notificationModel.updateMany(
          { _id: { $in: notifications.map((n) => n._id) } },
          { $set: { emailedAt: now } },
        );
        digestsSent += 1;
      }
    }
    return digestsSent;
  }
}
