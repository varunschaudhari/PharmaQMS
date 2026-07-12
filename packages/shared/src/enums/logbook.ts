// EQP-6: the digital logbook entry kinds (SPEC.md §7.3). AMENDMENT is the only permitted
// "correction" — entries are immutable (Iron Rule 3-adjacent: never edit, strike-through-style
// amendment instead).
export enum LogbookEntryType {
  USAGE_START = 'usage_start',
  USAGE_STOP = 'usage_stop',
  CLEANING = 'cleaning',
  BREAKDOWN = 'breakdown',
  AMENDMENT = 'amendment',
}

export enum CleaningType {
  ROUTINE = 'routine',
  FULL = 'full',
}

// EQP-7: a maintenance task's lifecycle. PENDING_VERIFICATION only exists when the tenant
// requires a QA/user verification sign-off after engineer completion (configurable — SPEC §7.3).
export enum MaintenanceTaskStatus {
  OPEN = 'open',
  PENDING_VERIFICATION = 'pending_verification',
  CLOSED = 'closed',
}
