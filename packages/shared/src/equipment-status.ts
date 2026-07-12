import { CalibrationStatus, QualificationStatus } from './enums/equipment';

// EQP-3/EQP-4: "Valid until DD-MMM / DUE / OVERDUE — color-coded" (SPEC.md §7.3). A pure,
// timezone-agnostic function so it's fully testable now, ahead of EQP-4 actually populating a
// due date — the status card calls this with `null` until then (always NOT_SCHEDULED).
export const CALIBRATION_DUE_SOON_WINDOW_DAYS = 30;

export function deriveCalibrationStatus(nextDueDate: string | null, now: Date = new Date()): CalibrationStatus {
  if (!nextDueDate) {
    return CalibrationStatus.NOT_SCHEDULED;
  }
  const due = new Date(nextDueDate);
  if (due <= now) {
    return CalibrationStatus.OVERDUE;
  }
  const horizon = new Date(now.getTime() + CALIBRATION_DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return due <= horizon ? CalibrationStatus.DUE_SOON : CalibrationStatus.VALID;
}

// EQP-8/EQP-9: the same VALID/DUE_SOON/OVERDUE date-window logic as deriveCalibrationStatus,
// reused (not copy-pasted) now that a third caller needs it — factored out here rather than in
// EQP-4's function so calibration's public signature/return type stays untouched.
type DueDateWindowStatus = 'not_scheduled' | 'valid' | 'due_soon' | 'overdue';

function deriveDueDateWindowStatus(nextDueDate: string | null, now: Date): DueDateWindowStatus {
  if (!nextDueDate) {
    return 'not_scheduled';
  }
  const due = new Date(nextDueDate);
  if (due <= now) {
    return 'overdue';
  }
  const horizon = new Date(now.getTime() + CALIBRATION_DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return due <= horizon ? 'due_soon' : 'valid';
}

// EQP-8: NOT_QUALIFIED until a PQ/REQUALIFICATION record has passed; QUALIFIED thereafter, or
// DUE_SOON/OVERDUE once a requalification frequency puts a due date on the calendar.
export function deriveQualificationStatus(
  hasPassedQualification: boolean,
  nextRequalificationDueDate: string | null,
  now: Date = new Date(),
): QualificationStatus {
  if (!hasPassedQualification) {
    return QualificationStatus.NOT_QUALIFIED;
  }
  const windowStatus = deriveDueDateWindowStatus(nextRequalificationDueDate, now);
  if (windowStatus === 'not_scheduled') {
    return QualificationStatus.QUALIFIED;
  }
  if (windowStatus === 'valid') {
    return QualificationStatus.QUALIFIED;
  }
  return windowStatus === 'overdue' ? QualificationStatus.OVERDUE : QualificationStatus.DUE_SOON;
}

// EQP-9: whether the equipment's next PM is due soon/overdue — same VALID/DUE_SOON/OVERDUE shape
// as calibration (no semantic reason for a distinct enum), used by both the status card and the
// daily scanner's auto-task-generation trigger.
export function derivePmStatus(nextDueDate: string | null, now: Date = new Date()): CalibrationStatus {
  const windowStatus = deriveDueDateWindowStatus(nextDueDate, now);
  return {
    not_scheduled: CalibrationStatus.NOT_SCHEDULED,
    valid: CalibrationStatus.VALID,
    due_soon: CalibrationStatus.DUE_SOON,
    overdue: CalibrationStatus.OVERDUE,
  }[windowStatus];
}
