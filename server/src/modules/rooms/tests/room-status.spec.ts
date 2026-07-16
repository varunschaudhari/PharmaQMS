import { CalibrationStatus, deriveRoomCleaningStatus } from '@pharmaqms/shared';

describe('QRX-1 room cleaning status derivation', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('QRX-1: no schedule at all is NOT_SCHEDULED', () => {
    expect(deriveRoomCleaningStatus(null, null, now)).toBe(CalibrationStatus.NOT_SCHEDULED);
  });

  it('QRX-1: both due dates far out is VALID', () => {
    expect(deriveRoomCleaningStatus('2026-12-01T00:00:00.000Z', '2026-12-15T00:00:00.000Z', now)).toBe(CalibrationStatus.VALID);
  });

  it('QRX-1: takes the WORSE of the two due dates — routine overdue beats full valid', () => {
    expect(deriveRoomCleaningStatus('2026-07-01T00:00:00.000Z', '2026-12-15T00:00:00.000Z', now)).toBe(CalibrationStatus.OVERDUE);
  });

  it('QRX-1: takes the WORSE of the two due dates — full overdue beats routine valid', () => {
    expect(deriveRoomCleaningStatus('2026-12-15T00:00:00.000Z', '2026-07-01T00:00:00.000Z', now)).toBe(CalibrationStatus.OVERDUE);
  });

  it('QRX-1: due-soon routine + valid full is DUE_SOON', () => {
    expect(deriveRoomCleaningStatus('2026-08-15T00:00:00.000Z', '2026-12-15T00:00:00.000Z', now)).toBe(CalibrationStatus.DUE_SOON);
  });
});
