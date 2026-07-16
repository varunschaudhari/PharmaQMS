import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  assertRoomStatusTransition,
  deriveRoomCleaningStatus,
  ErrorCode,
  RoomStatus,
  type CreateRoomRequest,
  type ListRoomsQuery,
  type RoomData,
  type RoomStatusCardData,
  type UpdateRoomRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { QrService } from '../../platform/qr/qr.service';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { toRoomCleaningEntryData } from './room-cleaning-mapper';
import { ROOM_ENTITY_TYPE, ROOM_NUMBERING_TYPE } from './room-entity-types';
import { Room, RoomDocument } from './schemas/room.schema';
import { RoomCleaningEntry, RoomCleaningEntryDocument } from './schemas/room-cleaning-entry.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleDocument } from './schemas/room-cleaning-schedule.schema';

const RECENT_CLEANING_ENTRY_LIMIT = 5;

@Injectable()
export class RoomService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
    @InjectModel(RoomCleaningSchedule.name) private readonly scheduleModel: Model<RoomCleaningScheduleDocument>,
    @InjectModel(RoomCleaningEntry.name) private readonly entryModel: Model<RoomCleaningEntryDocument>,
    private readonly numberingService: NumberingService,
    private readonly qrService: QrService,
  ) {}

  // QRX-1: create the master record and mint its QR identity in the same call — every room is
  // scannable from the moment it exists (same EQP-1/EQP-2 precedent).
  async create(tenantId: string, dto: CreateRoomRequest): Promise<RoomData> {
    if (dto.departmentId) {
      const department = await this.departmentModel.findOne({ _id: dto.departmentId, tenantId, isActive: true });
      if (!department) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Department not found.', HttpStatus.NOT_FOUND);
      }
    }

    const roomCode = await this.numberingService.generateNumber(tenantId, ROOM_NUMBERING_TYPE);

    const room = await this.roomModel.create({
      tenantId,
      roomCode,
      name: dto.name,
      block: dto.block ?? null,
      classification: dto.classification,
      status: RoomStatus.ACTIVE,
      departmentId: dto.departmentId ?? null,
    });

    await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: ROOM_ENTITY_TYPE,
      entityId: room._id.toString(),
      entityCode: roomCode,
      entityName: dto.name,
    });

    return this.toData(tenantId, room);
  }

  async update(tenantId: string, roomId: string, dto: UpdateRoomRequest): Promise<{ before: Record<string, unknown>; after: RoomData }> {
    const room = await this.findOrThrow(tenantId, roomId);
    const before = { name: room.name, block: room.block, classification: room.classification, departmentId: room.departmentId ? room.departmentId.toString() : null };

    if (dto.name !== undefined) room.name = dto.name;
    if (dto.block !== undefined) room.block = dto.block;
    if (dto.classification !== undefined) room.classification = dto.classification;
    if (dto.departmentId !== undefined) {
      room.departmentId = dto.departmentId as unknown as RoomDocument['departmentId'];
    }
    await room.save();

    return { before, after: await this.toData(tenantId, room) };
  }

  // QRX-1: the only way status changes — an explicit transition map, invalid throws (CLAUDE.md).
  async transitionStatus(tenantId: string, roomId: string, toStatus: RoomStatus): Promise<{ before: Record<string, unknown>; after: RoomData }> {
    const room = await this.findOrThrow(tenantId, roomId);
    const fromStatus = room.status;

    try {
      assertRoomStatusTransition(fromStatus, toStatus);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid room status transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    room.status = toStatus;
    await room.save();

    return { before: { status: fromStatus }, after: await this.toData(tenantId, room) };
  }

  async list(tenantId: string, options: ListRoomsQuery): Promise<{ items: RoomData[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId };
    if (options.status) filter.status = options.status;
    if (options.search) {
      filter.$or = [
        { name: { $regex: escapeRegex(options.search), $options: 'i' } },
        { roomCode: { $regex: escapeRegex(options.search), $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.roomModel
        .find(filter)
        .sort({ roomCode: 1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit),
      this.roomModel.countDocuments(filter),
    ]);
    return { items: await Promise.all(docs.map((doc) => this.toData(tenantId, doc))), total };
  }

  async get(tenantId: string, roomId: string): Promise<RoomData> {
    const room = await this.findOrThrow(tenantId, roomId);
    return this.toData(tenantId, room);
  }

  // QRX-1: the scan-to-status-card view — mirrors EQP-3, narrowed to cleaning status only.
  async getStatusCard(tenantId: string, roomId: string): Promise<RoomStatusCardData> {
    const [room, schedule, recentEntries] = await Promise.all([
      this.findOrThrow(tenantId, roomId),
      this.scheduleModel.findOne({ tenantId, roomId }),
      this.entryModel.find({ tenantId, roomId }).sort({ occurredAt: -1 }).limit(RECENT_CLEANING_ENTRY_LIMIT),
    ]);

    const nextRoutineDueDate = schedule ? schedule.nextRoutineDueDate.toISOString() : null;
    const nextFullDueDate = schedule ? schedule.nextFullDueDate.toISOString() : null;
    const cleaningStatus = deriveRoomCleaningStatus(nextRoutineDueDate, nextFullDueDate);
    const mappedEntries = recentEntries.map(toRoomCleaningEntryData);

    return {
      id: room._id.toString(),
      roomCode: room.roomCode,
      name: room.name,
      block: room.block,
      classification: room.classification,
      status: room.status,
      cleaningStatus,
      nextRoutineDueDate,
      nextFullDueDate,
      lastCleaningEntry: mappedEntries[0] ?? null,
      recentCleaningEntries: mappedEntries,
      // "Authenticated operator" may log a cleaning entry (QRX-1) without any elevated
      // permission — the scan itself is the access control, same as EQP-6.
      availableActions: room.status === RoomStatus.ACTIVE ? ['log_cleaning'] : [],
    };
  }

  async findOrThrow(tenantId: string, roomId: string): Promise<RoomDocument> {
    const room = await this.roomModel.findOne({ _id: roomId, tenantId });
    if (!room) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Room not found.', HttpStatus.NOT_FOUND);
    }
    return room;
  }

  private async toData(tenantId: string, room: RoomDocument): Promise<RoomData> {
    const { data: qr } = await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: ROOM_ENTITY_TYPE,
      entityId: room._id.toString(),
      entityCode: room.roomCode,
      entityName: room.name,
    });

    return {
      id: room._id.toString(),
      tenantId: room.tenantId.toString(),
      roomCode: room.roomCode,
      name: room.name,
      block: room.block,
      classification: room.classification,
      status: room.status,
      departmentId: room.departmentId ? room.departmentId.toString() : null,
      qr: { code: qr.code, scanUrl: qr.scanUrl },
      createdAt: (room as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
