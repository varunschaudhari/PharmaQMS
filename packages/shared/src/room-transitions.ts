import { RoomStatus } from './enums/room';

// QRX-1 lifecycle (SPEC.md §7.4), as an explicit transition map per CLAUDE.md — status is never
// set directly. Retired is terminal (Iron Rule 3: no un-retiring — a room brought back into
// service is a new record, same precedent as Equipment).
export const ROOM_STATUS_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  [RoomStatus.ACTIVE]: [RoomStatus.RETIRED],
  [RoomStatus.RETIRED]: [],
};

export function isRoomStatusTransitionAllowed(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_STATUS_TRANSITIONS[from].includes(to);
}

export function assertRoomStatusTransition(from: RoomStatus, to: RoomStatus): void {
  if (!isRoomStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid room status transition: ${from} -> ${to}`);
  }
}
