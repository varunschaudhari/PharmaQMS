import type { NotificationEvent } from '@pharmaqms/shared';

// PLT-6: the due-date scanner contract. Business modules register scanners for their own
// due-date semantics — DOC-6 periodic document review, TRN-5 overdue training, EQP-4 calibration
// due, EQP-9 preventive maintenance due — and the framework runs each once per tenant per day.
export interface DueDateScanContext {
  tenantId: string;
  // The calendar day this run covers, in the TENANT's timezone, formatted YYYY-MM-DD.
  runDate: string;
  // Server time of the run (SPEC.md §5.4: server timestamps only).
  now: Date;
}

export interface DueDateFinding {
  userId: string;
  event: NotificationEvent.DUE_SOON | NotificationEvent.OVERDUE;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  // Idempotency contract: a STABLE key per logical fact per recipient. Findings whose key was
  // already notified are silently skipped, so scanners may re-report the same fact every day.
  // Include the due date in the key so a rescheduled item notifies again; include runDate only
  // if the notification should deliberately repeat daily (e.g. an escalating overdue nag).
  dedupeKey: string;
}

export interface DueDateScanner {
  // Unique, stable identifier, namespaced by module: e.g. 'documents.periodic-review'.
  readonly key: string;
  scan(context: DueDateScanContext): Promise<DueDateFinding[]>;
}
