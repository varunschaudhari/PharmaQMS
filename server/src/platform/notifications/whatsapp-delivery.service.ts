import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { WhatsAppDeliveryStatus } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { resolveWhatsAppTemplateName } from '../tenant/tenant-settings.util';
import { Tenant, TenantDocument } from '../tenant/schemas/tenant.schema';
import { whatsappConfig, type WhatsAppConfig } from './config/whatsapp.config';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './whatsapp/whatsapp-provider.interface';

// PLT-6-WA: renders notification-log entries with an attached WhatsApp template into a real send
// via the provider-agnostic WhatsAppProvider. Runs from BullMQ workers (never in a request path).
// Idempotent on the happy path (an already-SENT/DELIVERED notification is never re-sent); on
// failure it THROWS so the BullMQ job fails and its attempts/backoff config retries the send —
// unlike EmailDeliveryService, which has no retry path today (email failures are rarer/less
// consequential than a paid-per-message WhatsApp API call failing transiently).
@Injectable()
export class WhatsAppDeliveryService {
  private readonly logger = new Logger(WhatsAppDeliveryService.name);

  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(whatsappConfig.KEY) private readonly config: WhatsAppConfig,
  ) {}

  async sendForNotification(notificationId: string): Promise<void> {
    const notification = await this.notificationModel.findById(notificationId);
    if (!notification || !notification.whatsappTemplateKey) {
      return;
    }
    if (
      notification.whatsappStatus === WhatsAppDeliveryStatus.SENT ||
      notification.whatsappStatus === WhatsAppDeliveryStatus.DELIVERED ||
      notification.whatsappStatus === WhatsAppDeliveryStatus.READ
    ) {
      return; // already delivered — never re-send
    }

    const user = await this.userModel.findOne({ _id: notification.userId, tenantId: notification.tenantId });
    if (!user) {
      this.logger.warn(`Notification ${notificationId}: recipient user not found — skipping WhatsApp send.`);
      return;
    }
    // Opt-out (or never opted in) is respected silently — this is a preference, not a failure.
    if (!user.whatsappOptIn || !user.whatsappPhoneNumber) {
      this.logger.debug(`Notification ${notificationId}: recipient has not opted in to WhatsApp — skipping.`);
      return;
    }

    const tenant = await this.tenantModel.findById(notification.tenantId);
    const templateName = resolveWhatsAppTemplateName(tenant, notification.whatsappTemplateKey);

    try {
      const result = await this.provider.send({
        to: user.whatsappPhoneNumber,
        templateName,
        templateLanguage: this.config.defaultTemplateLanguage,
        params: notification.whatsappTemplateParams ?? [],
      });
      notification.whatsappStatus = WhatsAppDeliveryStatus.SENT;
      notification.whatsappSentAt = new Date();
      notification.whatsappProviderMessageId = result.providerMessageId;
      notification.whatsappProviderResponse = result.raw;
      await notification.save();
    } catch (error) {
      notification.whatsappStatus = WhatsAppDeliveryStatus.FAILED;
      notification.whatsappAttempts += 1;
      notification.whatsappProviderResponse = error instanceof Error ? { message: error.message } : error;
      await notification.save();
      throw error; // rethrow: the BullMQ job fails and its attempts/backoff config retries
    }
  }

  // PLT-6-WA: called by the delivery-status webhook when Meta reports a later status
  // (delivered/read/failed) for a message we already sent. Matched by providerMessageId, not
  // notification id, since Meta's callback only knows its own message id.
  async recordDeliveryStatus(providerMessageId: string, status: WhatsAppDeliveryStatus, raw: unknown): Promise<void> {
    const notification = await this.notificationModel.findOne({ whatsappProviderMessageId: providerMessageId });
    if (!notification) {
      this.logger.warn(`Delivery-status callback for unknown WhatsApp message id ${providerMessageId} — ignored.`);
      return;
    }
    // Never regress a terminal status backwards (e.g. a late 'sent' echo arriving after 'read').
    if (statusRank(status) <= statusRank(notification.whatsappStatus)) {
      return;
    }
    notification.whatsappStatus = status;
    notification.whatsappProviderResponse = raw;
    await notification.save();
  }
}

const STATUS_RANK: Record<string, number> = {
  [WhatsAppDeliveryStatus.PENDING]: 0,
  [WhatsAppDeliveryStatus.SENT]: 1,
  [WhatsAppDeliveryStatus.DELIVERED]: 2,
  [WhatsAppDeliveryStatus.READ]: 3,
  [WhatsAppDeliveryStatus.FAILED]: 1,
};

function statusRank(status: WhatsAppDeliveryStatus | null): number {
  return status ? (STATUS_RANK[status] ?? 0) : -1;
}
