import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CalibrationStatus, NotificationEvent, deriveRoomCleaningStatus } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { ROOM_ENTITY_TYPE } from './room-entity-types';
import { Room, RoomDocument } from './schemas/room.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleDocument } from './schemas/room-cleaning-schedule.schema';

// QRX-1: registered into the PLT-6 due-date scanner framework (see RoomsModule.onModuleInit).
// Mirrors EQP-4's EquipmentCalibrationScanner exactly — notifies the room's department head, when
// one is configured; rooms with no departmentId set are silently skipped (same "continue" pattern
// as equipment when no department head is configured).
@Injectable()
export class RoomCleaningScanner implements DueDateScanner {
  readonly key = 'rooms.cleaning-due';

  constructor(
    @InjectModel(RoomCleaningSchedule.name) private readonly scheduleModel: Model<RoomCleaningScheduleDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const schedules = await this.scheduleModel.find({ tenantId: context.tenantId });
    if (schedules.length === 0) {
      return [];
    }

    const roomIds = schedules.map((s) => s.roomId);
    const roomDocs = await this.roomModel.find({ tenantId: context.tenantId, _id: { $in: roomIds } });
    const roomById = new Map(roomDocs.map((r) => [r._id.toString(), r]));

    const departmentIds = [...new Set(roomDocs.filter((r) => r.departmentId).map((r) => r.departmentId!.toString()))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const findings: DueDateFinding[] = [];
    for (const schedule of schedules) {
      const room = roomById.get(schedule.roomId.toString());
      if (!room || !room.departmentId) continue;

      const nextRoutineDueDate = schedule.nextRoutineDueDate.toISOString();
      const nextFullDueDate = schedule.nextFullDueDate.toISOString();
      const status = deriveRoomCleaningStatus(nextRoutineDueDate, nextFullDueDate, context.now);
      if (status !== CalibrationStatus.DUE_SOON && status !== CalibrationStatus.OVERDUE) {
        continue;
      }

      const headUserId = headByDepartment.get(room.departmentId.toString());
      if (!headUserId) {
        continue;
      }

      // The more urgent of the two due dates drives the dedupe key/body — whichever is earlier.
      const earliestDueDate = schedule.nextRoutineDueDate <= schedule.nextFullDueDate ? nextRoutineDueDate : nextFullDueDate;
      const dueDateKey = earliestDueDate.slice(0, 10);
      const overdue = status === CalibrationStatus.OVERDUE;
      const event = overdue ? NotificationEvent.OVERDUE : NotificationEvent.DUE_SOON;

      findings.push({
        userId: headUserId,
        event,
        entityType: ROOM_ENTITY_TYPE,
        entityId: room._id.toString(),
        title: `Room cleaning ${overdue ? 'overdue' : 'due soon'}: ${room.roomCode}`,
        body: `${room.roomCode} — ${room.name} cleaning is ${overdue ? 'overdue' : 'due soon'} (due ${dueDateKey}).`,
        dedupeKey: `room-cleaning:${room._id.toString()}:${dueDateKey}:${event}`,
      });
    }
    return findings;
  }
}
