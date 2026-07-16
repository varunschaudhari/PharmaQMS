import type { NotificationEvent } from '../enums/notification-event';
import type { WhatsAppDeliveryStatus } from '../enums/whatsapp-delivery-status';
import type { WhatsAppTemplateKey } from '../enums/whatsapp-template-key';

// PLT-6: one per-user notification-log entry (SPEC.md §6.1 PLT-6 — assigned / due-soon /
// overdue / approved / rejected). Regulated-adjacent: append-only in spirit (created + read-flag
// only, never edited or deleted), viewable in the UI bell and audited on creation.
export interface NotificationData {
  id: string;
  tenantId: string;
  // The recipient. Notifications are always per-user; role fan-out happens at creation time.
  userId: string;
  event: NotificationEvent;
  // The business entity this notification is about (polymorphic ref, same pattern as
  // AuditEvent/Signature/WorkflowInstance).
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  // Deduplication key for idempotent daily scans: same key = same logical notification, never
  // re-created (e.g. "due_soon:equipment:EQP-0042:calibration:2026-08-01").
  dedupeKey: string | null;
  isRead: boolean;
  // Set when the email transport accepted the message; null while pending or if the tenant is
  // in digest mode (the digest job sets it when the digest goes out).
  emailedAt: string | null;
  // PLT-6-WA: null when this notification's event has no WhatsApp template mapping (most
  // events) OR the tenant hasn't enabled the WhatsApp channel — non-null only when a WhatsApp
  // send was actually contemplated for this notification.
  whatsappTemplateKey: WhatsAppTemplateKey | null;
  whatsappTemplateParams: string[] | null;
  whatsappStatus: WhatsAppDeliveryStatus | null;
  whatsappSentAt: string | null;
  // Meta's message id for this send — the join key the delivery-status webhook matches on.
  whatsappProviderMessageId: string | null;
  // Raw provider response/error, kept for support/debugging (never displayed to end users).
  whatsappProviderResponse: unknown | null;
  whatsappAttempts: number;
  createdAt: string;
}

export interface UnreadCountData {
  unread: number;
}

// PLT-6: a due-date scanner registered by a business module (DOC-6 periodic review, TRN-5
// overdue training, EQP-4 calibration due, EQP-9 PM due). The framework runs each scanner once
// per tenant per day; findings become deduped notifications.
export interface DueDateScanRunData {
  id: string;
  tenantId: string;
  scannerKey: string;
  // The calendar day (tenant timezone, formatted YYYY-MM-DD) this run covers — the idempotency
  // anchor: one completed run per (tenant, scanner, day).
  runDate: string;
  notificationsCreated: number;
  completedAt: string;
}
