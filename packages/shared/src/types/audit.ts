import type { AuditAction } from '../enums/audit-action';

export interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// PLT-2: one immutable audit event (SPEC.md §5.1) — who/what/when/why.
export interface AuditEventData {
  id: string;
  tenantId: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  changes: AuditFieldChange[];
  reason: string | null;
  // Server UTC timestamp (ISO 8601) — the presentation layer formats to tenant timezone.
  occurredAt: string;
}
