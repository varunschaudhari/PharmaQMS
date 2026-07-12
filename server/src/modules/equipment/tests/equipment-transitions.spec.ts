import {
  EQUIPMENT_STATUS_TRANSITIONS,
  EquipmentStatus,
  assertEquipmentStatusTransition,
  isEquipmentStatusTransitionAllowed,
} from '@pharmaqms/shared';

describe('EQP-1 equipment status transition map', () => {
  it('EQP-1: Active can move to Under Maintenance, Under Qualification, Retired, or (EQP-5) Do Not Use', () => {
    expect(EQUIPMENT_STATUS_TRANSITIONS[EquipmentStatus.ACTIVE]).toEqual([
      EquipmentStatus.UNDER_MAINTENANCE,
      EquipmentStatus.UNDER_QUALIFICATION,
      EquipmentStatus.RETIRED,
      EquipmentStatus.DO_NOT_USE,
    ]);
  });

  it('EQP-5: Do Not Use is structurally reachable/leavable, but only via the calibration flow (service-layer guard, not this map)', () => {
    expect(EQUIPMENT_STATUS_TRANSITIONS[EquipmentStatus.DO_NOT_USE]).toEqual([
      EquipmentStatus.ACTIVE,
      EquipmentStatus.RETIRED,
    ]);
  });

  it('EQP-1: Under Maintenance / Under Qualification return to Active or go to Retired', () => {
    expect(isEquipmentStatusTransitionAllowed(EquipmentStatus.UNDER_MAINTENANCE, EquipmentStatus.ACTIVE)).toBe(true);
    expect(isEquipmentStatusTransitionAllowed(EquipmentStatus.UNDER_QUALIFICATION, EquipmentStatus.ACTIVE)).toBe(true);
    expect(isEquipmentStatusTransitionAllowed(EquipmentStatus.UNDER_MAINTENANCE, EquipmentStatus.RETIRED)).toBe(true);
  });

  it('EQP-1: Retired is terminal — no transitions out (Iron Rule 3)', () => {
    expect(EQUIPMENT_STATUS_TRANSITIONS[EquipmentStatus.RETIRED]).toEqual([]);
    for (const target of Object.values(EquipmentStatus)) {
      expect(() => assertEquipmentStatusTransition(EquipmentStatus.RETIRED, target)).toThrow(
        /Invalid equipment status transition/,
      );
    }
  });

  it('EQP-1: Under Maintenance cannot jump directly to Under Qualification', () => {
    expect(isEquipmentStatusTransitionAllowed(EquipmentStatus.UNDER_MAINTENANCE, EquipmentStatus.UNDER_QUALIFICATION)).toBe(
      false,
    );
  });
});
