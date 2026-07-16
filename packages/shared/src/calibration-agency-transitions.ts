import { CalibrationAgencyStatus } from './enums/calibration-agency';

// EQP-11 lifecycle, as an explicit transition map per CLAUDE.md. Both directions are allowed —
// Suspended is a reversible administrative hold (accreditation lapsed, contract dispute, etc.),
// not a terminal state like Room/Equipment's Retired.
export const CALIBRATION_AGENCY_STATUS_TRANSITIONS: Record<CalibrationAgencyStatus, readonly CalibrationAgencyStatus[]> = {
  [CalibrationAgencyStatus.ACTIVE]: [CalibrationAgencyStatus.SUSPENDED],
  [CalibrationAgencyStatus.SUSPENDED]: [CalibrationAgencyStatus.ACTIVE],
};

export function isCalibrationAgencyStatusTransitionAllowed(from: CalibrationAgencyStatus, to: CalibrationAgencyStatus): boolean {
  return CALIBRATION_AGENCY_STATUS_TRANSITIONS[from].includes(to);
}

export function assertCalibrationAgencyStatusTransition(from: CalibrationAgencyStatus, to: CalibrationAgencyStatus): void {
  if (!isCalibrationAgencyStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid calibration agency status transition: ${from} -> ${to}`);
  }
}
