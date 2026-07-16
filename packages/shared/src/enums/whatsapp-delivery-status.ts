// PLT-6-WA: lifecycle of a WhatsApp send attempt for one notification-log entry. PENDING is set
// when a send is enqueued; SENT/FAILED are set by the delivery attempt itself; DELIVERED (and,
// opportunistically, READ) arrive later via Meta's asynchronous status webhook.
export enum WhatsAppDeliveryStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}
