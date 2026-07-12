import { CalibrationStatus, deriveCalibrationStatus } from '@pharmaqms/shared';

describe('EQP-3/EQP-4 calibration status derivation', () => {
  it('EQP-3: no due date at all is NOT_SCHEDULED', () => {
    expect(deriveCalibrationStatus(null)).toBe(CalibrationStatus.NOT_SCHEDULED);
  });

  it('EQP-4: a due date in the past is OVERDUE', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(deriveCalibrationStatus('2026-07-01T00:00:00.000Z', now)).toBe(CalibrationStatus.OVERDUE);
  });

  it('EQP-4: a due date exactly now is OVERDUE (inclusive boundary)', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(deriveCalibrationStatus('2026-08-01T00:00:00.000Z', now)).toBe(CalibrationStatus.OVERDUE);
  });

  it('EQP-4: a due date within 30 days is DUE_SOON', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(deriveCalibrationStatus('2026-08-15T00:00:00.000Z', now)).toBe(CalibrationStatus.DUE_SOON);
  });

  it('EQP-4: a due date more than 30 days out is VALID', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(deriveCalibrationStatus('2026-12-01T00:00:00.000Z', now)).toBe(CalibrationStatus.VALID);
  });
});
