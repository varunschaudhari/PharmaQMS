import {
  assertCalibrationAgencyStatusTransition,
  CALIBRATION_AGENCY_STATUS_TRANSITIONS,
  CalibrationAgencyStatus,
  isCalibrationAgencyStatusTransitionAllowed,
} from '@pharmaqms/shared';

describe('EQP-11 calibration agency status transition map', () => {
  it('EQP-11: Active can move to Suspended', () => {
    expect(CALIBRATION_AGENCY_STATUS_TRANSITIONS[CalibrationAgencyStatus.ACTIVE]).toEqual([CalibrationAgencyStatus.SUSPENDED]);
  });

  it('EQP-11: Suspended can move back to Active (reversible, unlike Room/Equipment Retired)', () => {
    expect(CALIBRATION_AGENCY_STATUS_TRANSITIONS[CalibrationAgencyStatus.SUSPENDED]).toEqual([CalibrationAgencyStatus.ACTIVE]);
    expect(isCalibrationAgencyStatusTransitionAllowed(CalibrationAgencyStatus.SUSPENDED, CalibrationAgencyStatus.ACTIVE)).toBe(true);
  });

  it('EQP-11: a same-status "transition" is rejected', () => {
    expect(() => assertCalibrationAgencyStatusTransition(CalibrationAgencyStatus.ACTIVE, CalibrationAgencyStatus.ACTIVE)).toThrow(
      /Invalid calibration agency status transition/,
    );
  });
});
