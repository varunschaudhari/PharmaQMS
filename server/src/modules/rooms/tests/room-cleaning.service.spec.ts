import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CalibrationStatus, RoomClassification, RoomCleaningEntryType, RoomCleaningFrequency, RoomStatus } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { Department, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { ROOM_NUMBERING_TYPE } from '../room-entity-types';
import { RoomCleaningService } from '../room-cleaning.service';
import { RoomService } from '../room.service';
import { Room, RoomSchema } from '../schemas/room.schema';
import { RoomCleaningEntry, RoomCleaningEntryDocument, RoomCleaningEntrySchema } from '../schemas/room-cleaning-entry.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleSchema } from '../schemas/room-cleaning-schedule.schema';

describe('QRX-1 RoomCleaningService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let roomCleaningService: RoomCleaningService;
  let roomService: RoomService;
  let numberingService: NumberingService;
  let entryModel: Model<RoomCleaningEntryDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.APP_BASE_URL = 'https://qms.example.com';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [qrConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Room.name, schema: RoomSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: RoomCleaningSchedule.name, schema: RoomCleaningScheduleSchema },
          { name: RoomCleaningEntry.name, schema: RoomCleaningEntrySchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
        ]),
      ],
      providers: [RoomCleaningService, RoomService, NumberingService, QrService, PdfRenderService, AuditService],
    }).compile();

    roomCleaningService = moduleRef.get(RoomCleaningService);
    roomService = moduleRef.get(RoomService);
    numberingService = moduleRef.get(NumberingService);
    entryModel = moduleRef.get(getModelToken(RoomCleaningEntry.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Olive Operator' };

  async function seedRoom(): Promise<{ tenantId: string; roomId: string }> {
    const tenantId = id();
    await numberingService.createScheme({ tenantId, entityType: ROOM_NUMBERING_TYPE, prefix: 'ROOM', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false });
    const room = await roomService.create(tenantId, { name: 'Granulation Room', classification: RoomClassification.CONTROLLED });
    return { tenantId, roomId: room.id };
  }

  async function seedSchedule(tenantId: string, roomId: string): Promise<void> {
    await roomCleaningService.upsertSchedule(tenantId, roomId, actor, {
      routineFrequency: RoomCleaningFrequency.DAILY,
      fullCleaningIntervalDays: 7,
      nextRoutineDueDate: '2026-07-01T00:00:00.000Z',
      nextFullDueDate: '2026-07-01T00:00:00.000Z',
    });
  }

  it('QRX-1: upsertSchedule creates a schedule, then a second call updates it in place', async () => {
    const { tenantId, roomId } = await seedRoom();
    await seedSchedule(tenantId, roomId);

    const { after } = await roomCleaningService.upsertSchedule(tenantId, roomId, actor, {
      routineFrequency: RoomCleaningFrequency.WEEKLY,
      fullCleaningIntervalDays: 14,
      nextRoutineDueDate: '2026-08-01T00:00:00.000Z',
      nextFullDueDate: '2026-08-15T00:00:00.000Z',
    });

    expect(after.routineFrequency).toBe(RoomCleaningFrequency.WEEKLY);
    expect(after.fullCleaningIntervalDays).toBe(14);

    const schedule = await roomCleaningService.getSchedule(tenantId, roomId);
    expect(schedule!.routineFrequency).toBe(RoomCleaningFrequency.WEEKLY);
  });

  it('QRX-1: a ROUTINE cleaning entry advances only the routine due date', async () => {
    const { tenantId, roomId } = await seedRoom();
    await seedSchedule(tenantId, roomId);

    const before = await roomCleaningService.getSchedule(tenantId, roomId);
    const entry = await roomCleaningService.logCleaning(tenantId, roomId, actor, 'routine' as never);
    expect(entry.entryType).toBe(RoomCleaningEntryType.CLEANING);
    expect(entry.cleaningType).toBe('routine');

    const after = await roomCleaningService.getSchedule(tenantId, roomId);
    expect(after!.nextRoutineDueDate).not.toBe(before!.nextRoutineDueDate);
    expect(after!.nextFullDueDate).toBe(before!.nextFullDueDate);
  });

  it('QRX-1: a FULL cleaning entry advances BOTH due dates (full subsumes routine)', async () => {
    const { tenantId, roomId } = await seedRoom();
    await seedSchedule(tenantId, roomId);

    const before = await roomCleaningService.getSchedule(tenantId, roomId);
    await roomCleaningService.logCleaning(tenantId, roomId, actor, 'full' as never);

    const after = await roomCleaningService.getSchedule(tenantId, roomId);
    expect(after!.nextRoutineDueDate).not.toBe(before!.nextRoutineDueDate);
    expect(after!.nextFullDueDate).not.toBe(before!.nextFullDueDate);
  });

  it('QRX-1: logging a cleaning entry is blocked once the room is Retired', async () => {
    const { tenantId, roomId } = await seedRoom();
    await roomService.transitionStatus(tenantId, roomId, RoomStatus.RETIRED);
    await expect(roomCleaningService.logCleaning(tenantId, roomId, actor, 'routine' as never)).rejects.toThrow(/Retired/);
  });

  it('QRX-1: a correction is a NEW amendment entry — the original is never edited', async () => {
    const { tenantId, roomId } = await seedRoom();
    const original = await roomCleaningService.logCleaning(tenantId, roomId, actor, 'routine' as never);

    const amendment = await roomCleaningService.createAmendment(tenantId, roomId, actor, original.id, 'Wrong cleaning type — should have been Full.');
    expect(amendment.entryType).toBe(RoomCleaningEntryType.AMENDMENT);
    expect(amendment.amendsEntryId).toBe(original.id);

    const originalReloaded = await entryModel.findById(original.id);
    expect(originalReloaded!.cleaningType).toBe('routine'); // untouched
  });

  it('QRX-1: cleaning entries are append-only — a direct update/delete attempt throws', async () => {
    const { tenantId, roomId } = await seedRoom();
    const entry = await roomCleaningService.logCleaning(tenantId, roomId, actor, 'routine' as never);

    await expect(entryModel.updateOne({ _id: entry.id }, { $set: { cleaningType: 'full' } })).rejects.toThrow('append-only');
    await expect(entryModel.deleteOne({ _id: entry.id })).rejects.toThrow('append-only');
  });

  it('QRX-1: listCleaningDue reports only DUE_SOON/OVERDUE rooms, and skips Retired rooms', async () => {
    const { tenantId, roomId: overdueRoomId } = await seedRoom();
    await roomCleaningService.upsertSchedule(tenantId, overdueRoomId, actor, {
      routineFrequency: RoomCleaningFrequency.DAILY,
      fullCleaningIntervalDays: 7,
      nextRoutineDueDate: '2020-01-01T00:00:00.000Z',
      nextFullDueDate: '2020-01-01T00:00:00.000Z',
    });

    const validRoom = await roomService.create(tenantId, { name: 'Compression Room', classification: RoomClassification.GENERAL });
    await roomCleaningService.upsertSchedule(tenantId, validRoom.id, actor, {
      routineFrequency: RoomCleaningFrequency.DAILY,
      fullCleaningIntervalDays: 7,
      nextRoutineDueDate: '2099-01-01T00:00:00.000Z',
      nextFullDueDate: '2099-01-01T00:00:00.000Z',
    });

    const retiredRoom = await roomService.create(tenantId, { name: 'Old Suite', classification: RoomClassification.GENERAL });
    await roomCleaningService.upsertSchedule(tenantId, retiredRoom.id, actor, {
      routineFrequency: RoomCleaningFrequency.DAILY,
      fullCleaningIntervalDays: 7,
      nextRoutineDueDate: '2020-01-01T00:00:00.000Z',
      nextFullDueDate: '2020-01-01T00:00:00.000Z',
    });
    await roomService.transitionStatus(tenantId, retiredRoom.id, RoomStatus.RETIRED);

    const due = await roomCleaningService.listCleaningDue(tenantId);
    expect(due).toHaveLength(1);
    expect(due[0].roomId).toBe(overdueRoomId);
    expect(due[0].cleaningStatus).toBe(CalibrationStatus.OVERDUE);
  });

  it('Iron Rule 5: cleaning entries and schedules are invisible across tenants', async () => {
    const { tenantId, roomId } = await seedRoom();
    await seedSchedule(tenantId, roomId);
    await roomCleaningService.logCleaning(tenantId, roomId, actor, 'routine' as never);

    const otherTenant = id();
    await expect(roomCleaningService.getSchedule(otherTenant, roomId)).rejects.toThrow('Room not found.');
    await expect(roomCleaningService.listForRoom(otherTenant, roomId)).rejects.toThrow('Room not found.');
  });
});
