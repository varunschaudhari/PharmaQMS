// PLT-6: the notification event taxonomy (SPEC.md §6.1 PLT-6) — drives both the in-app
// notification log and templated email rendering.
export enum NotificationEvent {
  TASK_ASSIGNED = 'task_assigned',
  DUE_SOON = 'due_soon',
  OVERDUE = 'overdue',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
