import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { NotificationEvent, WhatsAppDeliveryStatus, WhatsAppTemplateKey } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

// PLT-6: per-user notification log (SPEC.md §6.1 PLT-6). Content is write-once — after creation
// the only mutable fields are the operational flags `isRead` and `emailedAt`; there is no update
// path for title/body/event and no delete path at all.
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  // See user.schema.ts: use SchemaTypes.ObjectId, not Types.ObjectId, for @Prop's `type:` option.
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // The recipient — notifications are always per-user; role fan-out happens at creation time.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(NotificationEvent), required: true })
  event!: NotificationEvent;

  // Polymorphic ref to the business entity (same pattern as AuditEvent/Signature).
  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ type: String, required: true })
  entityId!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  // Idempotency anchor for scanner-generated notifications: the same (tenant, user, dedupeKey)
  // is never created twice — see the partial unique index below.
  @Prop({ type: String, default: null })
  dedupeKey!: string | null;

  @Prop({ default: false })
  isRead!: boolean;

  // Stamped when the email transport accepted the message (immediately in immediate mode; by the
  // daily digest job in digest mode). Null = not yet emailed.
  @Prop({ type: Date, default: null })
  emailedAt!: Date | null;

  // PLT-6-WA: null when this notification's event has no WhatsApp template mapping — non-null
  // only when notify() was called with a `whatsapp` payload (see NotifyInput).
  @Prop({ type: String, enum: [...Object.values(WhatsAppTemplateKey), null], default: null })
  whatsappTemplateKey!: WhatsAppTemplateKey | null;

  @Prop({ type: [String], default: null })
  whatsappTemplateParams!: string[] | null;

  // Set to PENDING only when actually enqueued (tenant has the WhatsApp channel enabled); stays
  // null otherwise — see WhatsAppDeliveryService for the SENT/FAILED transitions and the webhook
  // controller for the later DELIVERED/READ transition.
  @Prop({ type: String, enum: [...Object.values(WhatsAppDeliveryStatus), null], default: null })
  whatsappStatus!: WhatsAppDeliveryStatus | null;

  @Prop({ type: Date, default: null })
  whatsappSentAt!: Date | null;

  // Meta's message id for this send — the join key the delivery-status webhook matches on.
  @Prop({ type: String, default: null, index: true })
  whatsappProviderMessageId!: string | null;

  // Raw provider response/error, kept for support/debugging (never displayed to end users).
  @Prop({ type: SchemaTypes.Mixed, default: null })
  whatsappProviderResponse!: unknown | null;

  @Prop({ type: Number, default: 0 })
  whatsappAttempts!: number;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Iron Rule 5: every compound index starts with tenantId.
NotificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, userId: 1, isRead: 1 });
// Digest job scans for unsent notifications per tenant.
NotificationSchema.index({ tenantId: 1, emailedAt: 1 });
// PLT-6: dedupe per recipient — unique only where a dedupeKey is present (event-driven
// notifications pass null and are never deduped).
NotificationSchema.index(
  { tenantId: 1, userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
