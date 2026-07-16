import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CalibrationStatus, RoomClassification, RoomStatus } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { ROOM_NUMBERING_TYPE } from '../room-entity-types';
import { RoomService } from '../room.service';
import { Room, RoomDocument, RoomSchema } from '../schemas/room.schema';
import { RoomCleaningEntry, RoomCleaningEntrySchema } from '../schemas/room-cleaning-entry.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleSchema } from '../schemas/room-cleaning-schedule.schema';

describe('QRX-1 RoomService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let roomService: RoomService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let roomModel: Model<RoomDocument>;

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
      providers: [RoomService, NumberingService, QrService, PdfRenderService, AuditService],
    }).compile();

    roomService = moduleRef.get(RoomService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    roomModel = moduleRef.get(getModelToken(Room.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  async function seedTenant(): Promise<{ tenantId: string; departmentId: string }> {
    const tenantId = id();
    const department = await departmentModel.create({ tenantId, name: 'Production', code: 'PROD' });
    await numberingService.createScheme({
      tenantId,
      entityType: ROOM_NUMBERING_TYPE,
      prefix: 'ROOM',
      useDepartmentToken: false,
      paddingWidth: 3,
      yearlyReset: false,
    });
    return { tenantId, departmentId: department._id.toString() };
  }

  it('QRX-1: creates a room with a numbered code, ACTIVE by default', async () => {
    const { tenantId } = await seedTenant();
    const room = await roomService.create(tenantId, { name: 'Granulation Room', block: 'Block A', classification: RoomClassification.CONTROLLED });

    expect(room.roomCode).toBe('ROOM-001');
    expect(room.status).toBe(RoomStatus.ACTIVE);
    expect(room.classification).toBe(RoomClassification.CONTROLLED);
    expect(room.block).toBe('Block A');
  });

  it('QRX-1: every created room gets a QR code with a working scan URL', async () => {
    const { tenantId } = await seedTenant();
    const room = await roomService.create(tenantId, { name: 'Compression Room', classification: RoomClassification.GENERAL });

    expect(room.qr).not.toBeNull();
    expect(room.qr!.scanUrl).toBe(`https://qms.example.com/s/${room.qr!.code}`);
  });

  it('QRX-1: rejects creation against an unknown department', async () => {
    const tenantId = id();
    await numberingService.createScheme({ tenantId, entityType: ROOM_NUMBERING_TYPE, prefix: 'ROOM', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false });
    await expect(
      roomService.create(tenantId, { name: 'X', classification: RoomClassification.GENERAL, departmentId: id() }),
    ).rejects.toThrow('Department not found.');
  });

  it('QRX-1: status transitions follow the explicit map — Active → Retired is fine, Retired → Active is not', async () => {
    const { tenantId } = await seedTenant();
    const room = await roomService.create(tenantId, { name: 'Packing Room', classification: RoomClassification.GENERAL });

    const retired = await roomService.transitionStatus(tenantId, room.id, RoomStatus.RETIRED);
    expect(retired.after.status).toBe(RoomStatus.RETIRED);

    await expect(roomService.transitionStatus(tenantId, room.id, RoomStatus.ACTIVE)).rejects.toThrow(AppException);
    const reloaded = await roomModel.findById(room.id);
    expect(reloaded!.status).toBe(RoomStatus.RETIRED);
  });

  it('QRX-1: the status card reports NOT_SCHEDULED cleaning status with no schedule configured, and log_cleaning is available while Active', async () => {
    const { tenantId } = await seedTenant();
    const room = await roomService.create(tenantId, { name: 'Weighing Room', classification: RoomClassification.CONTROLLED });

    const card = await roomService.getStatusCard(tenantId, room.id);
    expect(card.cleaningStatus).toBe(CalibrationStatus.NOT_SCHEDULED);
    expect(card.recentCleaningEntries).toEqual([]);
    expect(card.availableActions).toEqual(['log_cleaning']);

    await roomService.transitionStatus(tenantId, room.id, RoomStatus.RETIRED);
    const retiredCard = await roomService.getStatusCard(tenantId, room.id);
    expect(retiredCard.availableActions).toEqual([]);
  });

  it('QRX-1: list supports status filter and search, tenant-scoped', async () => {
    const { tenantId } = await seedTenant();
    const room1 = await roomService.create(tenantId, { name: 'Alpha Suite', classification: RoomClassification.GENERAL });
    await roomService.create(tenantId, { name: 'Beta Suite', classification: RoomClassification.GENERAL });
    await roomService.transitionStatus(tenantId, room1.id, RoomStatus.RETIRED);

    const retiredOnly = await roomService.list(tenantId, { page: 1, limit: 20, status: RoomStatus.RETIRED });
    expect(retiredOnly.total).toBe(1);
    expect(retiredOnly.items[0].name).toBe('Alpha Suite');

    const searchResult = await roomService.list(tenantId, { page: 1, limit: 20, search: 'Beta' });
    expect(searchResult.total).toBe(1);
    expect(searchResult.items[0].name).toBe('Beta Suite');
  });

  it('Iron Rule 5: rooms are invisible across tenants', async () => {
    const { tenantId } = await seedTenant();
    const room = await roomService.create(tenantId, { name: 'Isolation Room', classification: RoomClassification.CONTROLLED });
    const otherTenant = id();

    await expect(roomService.get(otherTenant, room.id)).rejects.toThrow('Room not found.');
    const list = await roomService.list(otherTenant, { page: 1, limit: 20 });
    expect(list.total).toBe(0);
  });
});
