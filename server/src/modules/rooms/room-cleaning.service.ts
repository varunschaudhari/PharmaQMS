import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  CalibrationStatus,
  deriveRoomCleaningStatus,
  ErrorCode,
  RoomCleaningEntryType,
  RoomCleaningFrequency,
  RoomStatus,
  type CleaningType,
  type RoomCleaningDueEntryData,
  type RoomCleaningEntryData,
  type RoomCleaningScheduleData,
  type UpsertRoomCleaningScheduleRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../../platform/audit/audit.service';
import { toRoomCleaningEntryData } from './room-cleaning-mapper';
import { ROOM_ENTITY_TYPE } from './room-entity-types';
import { RoomService } from './room.service';
import { Room, RoomDocument } from './schemas/room.schema';
import { RoomCleaningEntry, RoomCleaningEntryDocument } from './schemas/room-cleaning-entry.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleDocument } from './schemas/room-cleaning-schedule.schema';

export interface RoomCleaningActor {
  userId: string;
  fullName: string;
}

const MILLIS_PER_HOUR = 60 * 60 * 1000;

// QRX-1: the routine cadence expressed as an hour interval (v1 simplification — "per shift"
// assumes a 3-shift day, so its window is shorter than a plain daily check).
const ROUTINE_FREQUENCY_INTERVAL_HOURS: Record<RoomCleaningFrequency, number> = {
  [RoomCleaningFrequency.PER_SHIFT]: 8,
  [RoomCleaningFrequency.DAILY]: 24,
  [RoomCleaningFrequency.WEEKLY]: 24 * 7,
};

// QRX-1 (SPEC.md §7.4): room cleaning schedule + digital cleaning log — a sub-concern of the
// Rooms module (same architectural precedent as EQP-4/5's CalibrationService depending directly
// on EquipmentService — see that file's header comment). Every log entry is immutable (enforced
// at the schema layer); a correction is a NEW AMENDMENT entry, never an edit — reuses EQP-6's
// exact pattern per this session's brief.
@Injectable()
export class RoomCleaningService {
  constructor(
    @InjectModel(RoomCleaningSchedule.name) private readonly scheduleModel: Model<RoomCleaningScheduleDocument>,
    @InjectModel(RoomCleaningEntry.name) private readonly entryModel: Model<RoomCleaningEntryDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    private readonly roomService: RoomService,
    private readonly auditService: AuditService,
  ) {}

  // QRX-1: one active schedule per room — creating again replaces the config in place (same
  // upsert pattern as EQP-4's CalibrationService.upsertSchedule).
  async upsertSchedule(
    tenantId: string,
    roomId: string,
    actor: RoomCleaningActor,
    dto: UpsertRoomCleaningScheduleRequest,
  ): Promise<{ before: Record<string, unknown> | null; after: RoomCleaningScheduleData }> {
    await this.roomService.findOrThrow(tenantId, roomId);

    const existing = await this.scheduleModel.findOne({ tenantId, roomId });
    const before = existing
      ? {
          routineFrequency: existing.routineFrequency,
          fullCleaningIntervalDays: existing.fullCleaningIntervalDays,
          nextRoutineDueDate: existing.nextRoutineDueDate,
          nextFullDueDate: existing.nextFullDueDate,
        }
      : null;

    const schedule = existing ?? new this.scheduleModel({ tenantId, roomId });
    schedule.routineFrequency = dto.routineFrequency;
    schedule.fullCleaningIntervalDays = dto.fullCleaningIntervalDays;
    schedule.nextRoutineDueDate = new Date(dto.nextRoutineDueDate);
    schedule.nextFullDueDate = new Date(dto.nextFullDueDate);
    await schedule.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: ROOM_ENTITY_TYPE,
      entityId: roomId,
      action: AuditAction.ROOM_CLEANING_SCHEDULE_UPSERTED,
      before,
      after: {
        routineFrequency: schedule.routineFrequency,
        fullCleaningIntervalDays: schedule.fullCleaningIntervalDays,
        nextRoutineDueDate: schedule.nextRoutineDueDate,
        nextFullDueDate: schedule.nextFullDueDate,
      },
    });

    return { before, after: toScheduleData(schedule) };
  }

  async getSchedule(tenantId: string, roomId: string): Promise<RoomCleaningScheduleData | null> {
    await this.roomService.findOrThrow(tenantId, roomId);
    const schedule = await this.scheduleModel.findOne({ tenantId, roomId });
    return schedule ? toScheduleData(schedule) : null;
  }

  // QRX-1: logs a cleaning entry via an authenticated scan. A FULL clean subsumes routine
  // cleaning, so it advances BOTH due dates; a ROUTINE clean advances only its own.
  async logCleaning(
    tenantId: string,
    roomId: string,
    actor: RoomCleaningActor,
    cleaningType: CleaningType,
    remarks?: string,
  ): Promise<RoomCleaningEntryData> {
    const room = await this.roomService.findOrThrow(tenantId, roomId);
    if (room.status !== RoomStatus.ACTIVE) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Room is Retired — no further cleaning entries may be logged.', HttpStatus.BAD_REQUEST);
    }

    const entry = await this.entryModel.create({
      tenantId,
      roomId,
      entryType: RoomCleaningEntryType.CLEANING,
      cleaningType,
      remarks: remarks ?? null,
      performedByUserId: actor.userId,
      performedByUserFullName: actor.fullName,
      occurredAt: new Date(),
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: ROOM_ENTITY_TYPE,
      entityId: roomId,
      action: AuditAction.ROOM_CLEANING_LOGGED,
      before: null,
      after: { entryType: entry.entryType, cleaningType },
    });

    await this.advanceScheduleDueDates(tenantId, roomId, cleaningType, entry.occurredAt);

    return toRoomCleaningEntryData(entry);
  }

  // QRX-1: the ONLY way to "correct" an entry — a brand new AMENDMENT entry referencing the one
  // it corrects (mirrors EQP-6's createAmendment exactly).
  async createAmendment(
    tenantId: string,
    roomId: string,
    actor: RoomCleaningActor,
    amendsEntryId: string,
    description: string,
  ): Promise<RoomCleaningEntryData> {
    await this.roomService.findOrThrow(tenantId, roomId);
    const original = await this.entryModel.findOne({ _id: amendsEntryId, tenantId, roomId });
    if (!original) {
      throw new AppException(ErrorCode.NOT_FOUND, 'The cleaning entry being amended was not found.', HttpStatus.NOT_FOUND);
    }

    const entry = await this.entryModel.create({
      tenantId,
      roomId,
      entryType: RoomCleaningEntryType.AMENDMENT,
      remarks: description,
      amendsEntryId,
      performedByUserId: actor.userId,
      performedByUserFullName: actor.fullName,
      occurredAt: new Date(),
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: ROOM_ENTITY_TYPE,
      entityId: roomId,
      action: AuditAction.ROOM_CLEANING_LOGGED,
      before: null,
      after: { entryType: entry.entryType, amendsEntryId },
    });

    return toRoomCleaningEntryData(entry);
  }

  async listForRoom(tenantId: string, roomId: string): Promise<RoomCleaningEntryData[]> {
    await this.roomService.findOrThrow(tenantId, roomId);
    const entries = await this.entryModel.find({ tenantId, roomId }).sort({ occurredAt: -1 });
    return entries.map(toRoomCleaningEntryData);
  }

  // QRX-1 scanner support: every room in the tenant with an active cleaning schedule.
  async listAllSchedules(tenantId: string): Promise<RoomCleaningScheduleDocument[]> {
    return this.scheduleModel.find({ tenantId });
  }

  // QRX-1 (d): QA-dashboard overdue-rooms feed — mirrors CalibrationService.listDue() exactly.
  async listCleaningDue(tenantId: string): Promise<RoomCleaningDueEntryData[]> {
    const schedules = await this.scheduleModel.find({ tenantId });
    if (schedules.length === 0) {
      return [];
    }

    const rooms = await this.roomModel.find({ tenantId, _id: { $in: schedules.map((s) => s.roomId) } });
    const roomsById = new Map(rooms.map((room) => [room._id.toString(), room]));

    const due: RoomCleaningDueEntryData[] = [];
    for (const schedule of schedules) {
      const room = roomsById.get(schedule.roomId.toString());
      if (!room || room.status !== RoomStatus.ACTIVE) {
        continue;
      }

      const nextRoutineDueDate = schedule.nextRoutineDueDate.toISOString();
      const nextFullDueDate = schedule.nextFullDueDate.toISOString();
      const cleaningStatus = deriveRoomCleaningStatus(nextRoutineDueDate, nextFullDueDate);
      if (cleaningStatus !== CalibrationStatus.DUE_SOON && cleaningStatus !== CalibrationStatus.OVERDUE) {
        continue;
      }

      const nextDueDate = schedule.nextRoutineDueDate <= schedule.nextFullDueDate ? nextRoutineDueDate : nextFullDueDate;
      due.push({
        roomId: room._id.toString(),
        roomCode: room.roomCode,
        roomName: room.name,
        cleaningStatus,
        nextDueDate,
      });
    }

    return due;
  }

  private async advanceScheduleDueDates(tenantId: string, roomId: string, cleaningType: CleaningType, occurredAt: Date): Promise<void> {
    const schedule = await this.scheduleModel.findOne({ tenantId, roomId });
    if (!schedule) {
      return; // no schedule configured yet — nothing to advance
    }

    const routineIntervalMs = ROUTINE_FREQUENCY_INTERVAL_HOURS[schedule.routineFrequency] * MILLIS_PER_HOUR;
    schedule.nextRoutineDueDate = new Date(occurredAt.getTime() + routineIntervalMs);

    if (cleaningType === 'full') {
      const fullIntervalMs = schedule.fullCleaningIntervalDays * 24 * MILLIS_PER_HOUR;
      schedule.nextFullDueDate = new Date(occurredAt.getTime() + fullIntervalMs);
    }
    await schedule.save();
  }
}

function toScheduleData(doc: RoomCleaningScheduleDocument): RoomCleaningScheduleData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    roomId: doc.roomId.toString(),
    routineFrequency: doc.routineFrequency,
    fullCleaningIntervalDays: doc.fullCleaningIntervalDays,
    nextRoutineDueDate: doc.nextRoutineDueDate.toISOString(),
    nextFullDueDate: doc.nextFullDueDate.toISOString(),
  };
}
