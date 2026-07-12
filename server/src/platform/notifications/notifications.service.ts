import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  NotificationEmailMode,
  NotificationEvent,
  type NotificationData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { resolveNotificationEmailMode } from '../tenant/tenant-settings.util';
import { Tenant, TenantDocument } from '../tenant/schemas/tenant.schema';
import { NOTIFICATION_JOBS, type NotificationJobs } from './jobs/notification-jobs.interface';
import { Notification, NotificationDocument } from './schemas/notification.schema';

export interface NotifyInput {
  tenantId: string;
  userId: string;
  event: NotificationEvent;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  // Present for scanner-generated notifications (idempotent daily runs); null/absent for
  // event-driven ones, which are inherently once-per-event.
  dedupeKey?: string | null;
  // The human whose action triggered this (workflow approver/rejecter), or null for
  // system-generated notifications (due-date scans).
  actor?: { userId: string; fullName: string } | null;
}

const MONGO_DUPLICATE_KEY = 11000;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    private readonly auditService: AuditService,
    @Inject(NOTIFICATION_JOBS) private readonly jobs: NotificationJobs,
  ) {}

  // PLT-6: the ONE writer of the notification log. Creation is audited (Iron Rule 1); a
  // duplicate dedupeKey resolves to null (already notified — idempotent), never an error.
  async notify(input: NotifyInput): Promise<NotificationData | null> {
    let doc: NotificationDocument;
    try {
      doc = await this.notificationModel.create({
        tenantId: input.tenantId,
        userId: input.userId,
        event: input.event,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey ?? null,
      });
    } catch (error) {
      // The partial unique index on (tenantId, userId, dedupeKey) is the atomic dedupe check —
      // no read-then-write race.
      if (isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }

    await this.auditService.record({
      tenantId: input.tenantId,
      actor: input.actor ?? null,
      entityType: 'Notification',
      entityId: doc._id.toString(),
      action: AuditAction.CREATE,
      before: null,
      after: {
        userId: input.userId,
        event: input.event,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
      },
    });

    // PLT-6 digest option: immediate mode enqueues a per-notification email; digest mode leaves
    // emailedAt=null for the daily digest job to sweep up.
    const tenant = await this.tenantModel.findById(input.tenantId);
    if (resolveNotificationEmailMode(tenant) === NotificationEmailMode.IMMEDIATE) {
      this.jobs.enqueueEmail(doc._id.toString());
    }

    return toNotificationData(doc);
  }

  async list(
    tenantId: string,
    userId: string,
    options: { page: number; limit: number; unreadOnly: boolean },
  ): Promise<{ items: NotificationData[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId, userId };
    if (options.unreadOnly) {
      filter.isRead = false;
    }
    const [docs, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit),
      this.notificationModel.countDocuments(filter),
    ]);
    return { items: docs.map(toNotificationData), total };
  }

  async unreadCount(tenantId: string, userId: string): Promise<number> {
    return this.notificationModel.countDocuments({ tenantId, userId, isRead: false });
  }

  // PLT-6: reading is the only mutation a notification supports. Scoped to the caller's own
  // notifications — you can never mark someone else's read.
  async markRead(
    tenantId: string,
    userId: string,
    target: { notificationIds: string[] } | { all: true },
  ): Promise<{ before: { unread: number }; after: { unread: number }; updated: number }> {
    const unreadBefore = await this.unreadCount(tenantId, userId);

    const filter: Record<string, unknown> = { tenantId, userId, isRead: false };
    if ('notificationIds' in target) {
      filter._id = { $in: target.notificationIds };
    }
    const result = await this.notificationModel.updateMany(filter, { $set: { isRead: true } });

    const unreadAfter = await this.unreadCount(tenantId, userId);
    return { before: { unread: unreadBefore }, after: { unread: unreadAfter }, updated: result.modifiedCount };
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === MONGO_DUPLICATE_KEY
  );
}

function toNotificationData(doc: NotificationDocument): NotificationData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    userId: doc.userId.toString(),
    event: doc.event,
    entityType: doc.entityType,
    entityId: doc.entityId,
    title: doc.title,
    body: doc.body,
    dedupeKey: doc.dedupeKey,
    isRead: doc.isRead,
    emailedAt: doc.emailedAt ? doc.emailedAt.toISOString() : null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}
