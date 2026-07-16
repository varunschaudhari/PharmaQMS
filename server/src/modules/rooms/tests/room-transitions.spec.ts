import { assertRoomStatusTransition, isRoomStatusTransitionAllowed, ROOM_STATUS_TRANSITIONS, RoomStatus } from '@pharmaqms/shared';

describe('QRX-1 room status transition map', () => {
  it('QRX-1: Active can move to Retired', () => {
    expect(ROOM_STATUS_TRANSITIONS[RoomStatus.ACTIVE]).toEqual([RoomStatus.RETIRED]);
  });

  it('QRX-1: Retired is terminal — no transitions out (Iron Rule 3)', () => {
    expect(ROOM_STATUS_TRANSITIONS[RoomStatus.RETIRED]).toEqual([]);
    for (const target of Object.values(RoomStatus)) {
      expect(() => assertRoomStatusTransition(RoomStatus.RETIRED, target)).toThrow(/Invalid room status transition/);
    }
  });

  it('QRX-1: Active -> Retired is allowed; Retired -> Active is not', () => {
    expect(isRoomStatusTransitionAllowed(RoomStatus.ACTIVE, RoomStatus.RETIRED)).toBe(true);
    expect(isRoomStatusTransitionAllowed(RoomStatus.RETIRED, RoomStatus.ACTIVE)).toBe(false);
  });
});
