import { EquipmentStatus } from './enums/equipment';

// EQP-1 lifecycle (SPEC.md §7.3), as an explicit transition map per CLAUDE.md — status is never
// set directly. Retired is terminal (Iron Rule 3). Do Not Use is STRUCTURALLY reachable/leavable
// here, but the service layer (not this map) additionally forbids the generic status-change
// endpoint from entering or leaving it — see EQP-5: only the calibration OOT/disposition flow
// may do that.
export const EQUIPMENT_STATUS_TRANSITIONS: Record<EquipmentStatus, readonly EquipmentStatus[]> = {
  [EquipmentStatus.ACTIVE]: [
    EquipmentStatus.UNDER_MAINTENANCE,
    EquipmentStatus.UNDER_QUALIFICATION,
    EquipmentStatus.RETIRED,
    EquipmentStatus.DO_NOT_USE,
  ],
  [EquipmentStatus.UNDER_MAINTENANCE]: [EquipmentStatus.ACTIVE, EquipmentStatus.RETIRED, EquipmentStatus.DO_NOT_USE],
  [EquipmentStatus.UNDER_QUALIFICATION]: [EquipmentStatus.ACTIVE, EquipmentStatus.RETIRED, EquipmentStatus.DO_NOT_USE],
  [EquipmentStatus.DO_NOT_USE]: [EquipmentStatus.ACTIVE, EquipmentStatus.RETIRED],
  [EquipmentStatus.RETIRED]: [],
};

export function isEquipmentStatusTransitionAllowed(from: EquipmentStatus, to: EquipmentStatus): boolean {
  return EQUIPMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function assertEquipmentStatusTransition(from: EquipmentStatus, to: EquipmentStatus): void {
  if (!isEquipmentStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid equipment status transition: ${from} -> ${to}`);
  }
}
