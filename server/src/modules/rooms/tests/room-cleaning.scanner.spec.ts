import { NotificationEvent } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { RoomCleaningScanner } from '../room-cleaning.scanner';
import type { RoomDocument } from '../schemas/room.schema';
import type { RoomCleaningScheduleDocument } from '../schemas/room-cleaning-schedule.schema';

describe('QRX-1 room-cleaning due-date scanner', () => {
  const objId = (hex: string) => new mongoose.Types.ObjectId(hex);

  function makeScanner(
    schedules: Array<Partial<RoomCleaningScheduleDocument>>,
    rooms: Array<Partial<RoomDocument>>,
    departments: Array<Partial<DepartmentDocument>>,
  ) {
    const scheduleModel = { find: jest.fn().mockResolvedValue(schedules) } as unknown as Model<RoomCleaningScheduleDocument>;
    const roomModel = { find: jest.fn().mockResolvedValue(rooms) } as unknown as Model<RoomDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return new RoomCleaningScanner(scheduleModel, roomModel, departmentModel);
  }

  it('QRX-1: registers under a stable key', () => {
    const scanner = makeScanner([], [], []);
    expect(scanner.key).toBe('rooms.cleaning-due');
  });

  it('QRX-1: an overdue routine due date notifies the room department head (not the operator)', async () => {
    const roomId = objId('507f1f77bcf86cd799439021');
    const departmentId = objId('507f1f77bcf86cd799439022');
    const scanner = makeScanner(
      [
        {
          roomId,
          nextRoutineDueDate: new Date('2026-01-01T00:00:00.000Z'),
          nextFullDueDate: new Date('2099-01-01T00:00:00.000Z'),
        } as unknown as RoomCleaningScheduleDocument,
      ],
      [{ _id: roomId, roomCode: 'ROOM-001', name: 'Granulation Room', departmentId } as unknown as RoomDocument],
      [{ _id: departmentId, headUserId: 'head-user-1' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });

    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('head-user-1');
    expect(findings[0].event).toBe(NotificationEvent.OVERDUE);
    expect(findings[0].entityId).toBe(roomId.toString());
    expect(findings[0].title).toContain('overdue');
  });

  it('QRX-1: a room with no department configured produces no finding', async () => {
    const roomId = objId('507f1f77bcf86cd799439023');
    const scanner = makeScanner(
      [
        {
          roomId,
          nextRoutineDueDate: new Date('2026-01-01T00:00:00.000Z'),
          nextFullDueDate: new Date('2026-01-01T00:00:00.000Z'),
        } as unknown as RoomCleaningScheduleDocument,
      ],
      [{ _id: roomId, roomCode: 'ROOM-002', name: 'Compression Room', departmentId: null } as unknown as RoomDocument],
      [],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('QRX-1: a room whose department has no configured head produces no finding', async () => {
    const roomId = objId('507f1f77bcf86cd799439024');
    const departmentId = objId('507f1f77bcf86cd799439025');
    const scanner = makeScanner(
      [
        {
          roomId,
          nextRoutineDueDate: new Date('2026-01-01T00:00:00.000Z'),
          nextFullDueDate: new Date('2026-01-01T00:00:00.000Z'),
        } as unknown as RoomCleaningScheduleDocument,
      ],
      [{ _id: roomId, roomCode: 'ROOM-003', name: 'Packing Room', departmentId } as unknown as RoomDocument],
      [{ _id: departmentId, headUserId: null } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('QRX-1: both due dates far in the future (VALID) produce no finding', async () => {
    const roomId = objId('507f1f77bcf86cd799439026');
    const departmentId = objId('507f1f77bcf86cd799439027');
    const scanner = makeScanner(
      [
        {
          roomId,
          nextRoutineDueDate: new Date('2099-01-01T00:00:00.000Z'),
          nextFullDueDate: new Date('2099-01-01T00:00:00.000Z'),
        } as unknown as RoomCleaningScheduleDocument,
      ],
      [{ _id: roomId, roomCode: 'ROOM-004', name: 'Weighing Room', departmentId } as unknown as RoomDocument],
      [{ _id: departmentId, headUserId: 'head-user-2' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('QRX-1: no schedules produces no findings', async () => {
    const scanner = makeScanner([], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });

  it('QRX-1: a due-soon full-clean date (within 30 days) notifies with a due_soon event, taking the worse of the two dates', async () => {
    const roomId = objId('507f1f77bcf86cd799439028');
    const departmentId = objId('507f1f77bcf86cd799439029');
    const now = new Date('2026-07-11T00:00:00.000Z');
    const dueSoon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const scanner = makeScanner(
      [
        {
          roomId,
          nextRoutineDueDate: new Date('2099-01-01T00:00:00.000Z'),
          nextFullDueDate: dueSoon,
        } as unknown as RoomCleaningScheduleDocument,
      ],
      [{ _id: roomId, roomCode: 'ROOM-005', name: 'Isolation Room', departmentId } as unknown as RoomDocument],
      [{ _id: departmentId, headUserId: 'head-user-3' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now });
    expect(findings).toHaveLength(1);
    expect(findings[0].event).toBe(NotificationEvent.DUE_SOON);
  });
});
