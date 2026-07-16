import {
  assertMaterialLotStatusTransition,
  isMaterialLotStatusTransitionAllowed,
  MATERIAL_LOT_STATUS_TRANSITIONS,
  MaterialLotStatus,
} from '@pharmaqms/shared';

describe('QRX-2 material lot status transition map', () => {
  it('QRX-2: Quarantine can move to Under Test or straight to Rejected', () => {
    expect(MATERIAL_LOT_STATUS_TRANSITIONS[MaterialLotStatus.QUARANTINE]).toEqual([
      MaterialLotStatus.UNDER_TEST,
      MaterialLotStatus.REJECTED,
    ]);
  });

  it('QRX-2: Under Test can move to Approved or Rejected', () => {
    expect(MATERIAL_LOT_STATUS_TRANSITIONS[MaterialLotStatus.UNDER_TEST]).toEqual([
      MaterialLotStatus.APPROVED,
      MaterialLotStatus.REJECTED,
    ]);
  });

  it('QRX-2: Approved and Rejected are both terminal — no transitions out (Iron Rule 3)', () => {
    expect(MATERIAL_LOT_STATUS_TRANSITIONS[MaterialLotStatus.APPROVED]).toEqual([]);
    expect(MATERIAL_LOT_STATUS_TRANSITIONS[MaterialLotStatus.REJECTED]).toEqual([]);
    for (const target of Object.values(MaterialLotStatus)) {
      expect(() => assertMaterialLotStatusTransition(MaterialLotStatus.APPROVED, target)).toThrow(
        /Invalid material lot status transition/,
      );
      expect(() => assertMaterialLotStatusTransition(MaterialLotStatus.REJECTED, target)).toThrow(
        /Invalid material lot status transition/,
      );
    }
  });

  it('QRX-2: Quarantine cannot jump directly to Approved', () => {
    expect(isMaterialLotStatusTransitionAllowed(MaterialLotStatus.QUARANTINE, MaterialLotStatus.APPROVED)).toBe(false);
  });
});
