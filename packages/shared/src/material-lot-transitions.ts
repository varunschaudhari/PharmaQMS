import { MaterialLotStatus } from './enums/material-lot';

// QRX-2 lifecycle (SPEC.md §7.4), as an explicit transition map per CLAUDE.md — status is never
// set directly. Approved and Rejected are both terminal (Iron Rule 3-style — a disposition
// decision is not walked back; a material found bad after approval, or one that needs
// re-testing after rejection, gets a new lot record). Quarantine may reject directly (no need to
// force a test cycle before rejecting a visibly-bad lot).
export const MATERIAL_LOT_STATUS_TRANSITIONS: Record<MaterialLotStatus, readonly MaterialLotStatus[]> = {
  [MaterialLotStatus.QUARANTINE]: [MaterialLotStatus.UNDER_TEST, MaterialLotStatus.REJECTED],
  [MaterialLotStatus.UNDER_TEST]: [MaterialLotStatus.APPROVED, MaterialLotStatus.REJECTED],
  [MaterialLotStatus.APPROVED]: [],
  [MaterialLotStatus.REJECTED]: [],
};

export function isMaterialLotStatusTransitionAllowed(from: MaterialLotStatus, to: MaterialLotStatus): boolean {
  return MATERIAL_LOT_STATUS_TRANSITIONS[from].includes(to);
}

export function assertMaterialLotStatusTransition(from: MaterialLotStatus, to: MaterialLotStatus): void {
  if (!isMaterialLotStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid material lot status transition: ${from} -> ${to}`);
  }
}
