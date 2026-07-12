// TRN-1/TRN-3: a training assignment's stored state. "Overdue" is deliberately NOT a stored
// state — it's derived at read time from (assignedAt + tenant grace period), the same pattern
// DOC-6 uses for nextReviewDate, so a tenant-wide grace-period change retroactively re-derives
// every pending assignment's due date without a migration.
export enum TrainingAssignmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}
