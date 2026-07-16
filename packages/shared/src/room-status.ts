import { CalibrationStatus } from './enums/equipment';
import { deriveDueDateWindowStatus, type DueDateWindowStatus } from './equipment-status';

// QRX-1 (SPEC.md §7.4): "scan → cleaning status (last cleaned, by whom, due)" — reuses
// CalibrationStatus's VALID/DUE_SOON/OVERDUE/NOT_SCHEDULED shape (same precedent as EQP-9's PM
// status: no semantic reason for a distinct enum) rather than reinventing a room-specific one.
// A room tracks TWO independent due dates (routine cleaning cadence + full/deep-clean interval);
// the overall status shown on the scan card is the WORSE of the two windows — a room that's
// routine-clean but overdue for its full clean is still OVERDUE overall.
const WINDOW_STATUS_RANK: Record<DueDateWindowStatus, number> = {
  not_scheduled: 0,
  valid: 1,
  due_soon: 2,
  overdue: 3,
};

const WINDOW_TO_CALIBRATION_STATUS: Record<DueDateWindowStatus, CalibrationStatus> = {
  not_scheduled: CalibrationStatus.NOT_SCHEDULED,
  valid: CalibrationStatus.VALID,
  due_soon: CalibrationStatus.DUE_SOON,
  overdue: CalibrationStatus.OVERDUE,
};

export function deriveRoomCleaningStatus(
  nextRoutineDueDate: string | null,
  nextFullDueDate: string | null,
  now: Date = new Date(),
): CalibrationStatus {
  const routine = deriveDueDateWindowStatus(nextRoutineDueDate, now);
  const full = deriveDueDateWindowStatus(nextFullDueDate, now);
  const worse = WINDOW_STATUS_RANK[routine] >= WINDOW_STATUS_RANK[full] ? routine : full;
  return WINDOW_TO_CALIBRATION_STATUS[worse];
}
