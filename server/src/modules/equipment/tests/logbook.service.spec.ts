import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { EquipmentStatus, LogbookEntryType } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../../common/storage/file-storage.interface';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleDocument, RoleSchema } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../../platform/auth/schemas/user.schema';
import { esignConfig } from '../../../platform/esign/config/esign.config';
import { EsignService } from '../../../platform/esign/esign.service';
import { Signature, SignatureSchema } from '../../../platform/esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../../platform/esign/schemas/signing-token-usage.schema';
import { NOTIFICATION_JOBS } from '../../../platform/notifications/jobs/notification-jobs.interface';
import { NotificationsService } from '../../../platform/notifications/notifications.service';
import { Notification, NotificationSchema } from '../../../platform/notifications/schemas/notification.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationService } from '../calibration.service';
import { CalibrationRecord, CalibrationRecordSchema } from '../schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from '../schemas/equipment.schema';
import { EquipmentService } from '../equipment.service';
import { LogbookEntry, LogbookEntryDocument, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
import { LogbookService } from '../logbook.service';
import { MaintenanceTask, MaintenanceTaskSchema } from '../schemas/maintenance-task.schema';
import { MaintenanceService } from '../maintenance.service';
import { PmPlan, PmPlanSchema } from '../schemas/pm-plan.schema';
import { QualificationRecord, QualificationRecordSchema } from '../schemas/qualification-record.schema';

class MemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, StoredFile>();
  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    this.files.set(key, { buffer, contentType });
  }
  async get(key: string): Promise<StoredFile> {
    const file = this.files.get(key);
    if (!file) throw new Error(`Not found: ${key}`);
    return file;
  }
}

describe('EQP-6 EQP-7 LogbookService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let logbookService: LogbookService;
  let equipmentService: EquipmentService;
  let maintenanceService: MaintenanceService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let tenantModel: Model<TenantDocument>;
  let entryModel: Model<LogbookEntryDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.APP_BASE_URL = 'https://qms.example.com';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [qrConfig, esignConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Equipment.name, schema: EquipmentSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: CalibrationSchedule.name, schema: CalibrationScheduleSchema },
          { name: CalibrationRecord.name, schema: CalibrationRecordSchema },
          { name: LogbookEntry.name, schema: LogbookEntrySchema },
          { name: MaintenanceTask.name, schema: MaintenanceTaskSchema },
          { name: QualificationRecord.name, schema: QualificationRecordSchema },
          { name: PmPlan.name, schema: PmPlanSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [
        LogbookService,
        EquipmentService,
        MaintenanceService,
        CalibrationService,
        NumberingService,
        QrService,
        PdfRenderService,
        AuditService,
        EsignService,
        NotificationsService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail: jest.fn() } },
        { provide: FILE_STORAGE, useValue: new MemoryFileStorage() },
      ],
    }).compile();

    logbookService = moduleRef.get(LogbookService);
    equipmentService = moduleRef.get(EquipmentService);
    maintenanceService = moduleRef.get(MaintenanceService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    entryModel = moduleRef.get(getModelToken(LogbookEntry.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Olive Operator' };

  async function seedEquipment(): Promise<{ tenantId: string; equipmentId: string }> {
    const tenantId = id();
    await tenantModel.create({ _id: tenantId, name: 'Acme Pharma', slug: `acme-${tenantId}` });
    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    await numberingService.createScheme({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    const equipment = await equipmentService.create(tenantId, {
      name: 'pH Meter', location: 'QC Lab', departmentId: department._id.toString(), isGmpCritical: true,
    });
    return { tenantId, equipmentId: equipment.id };
  }

  it('EQP-6: usage start then stop, in order', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const started = await logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-001');
    expect(started.entryType).toBe(LogbookEntryType.USAGE_START);
    expect(started.productBatchRef).toBe('BATCH-001');

    const stopped = await logbookService.logUsageStop(tenantId, equipmentId, actor);
    expect(stopped.entryType).toBe(LogbookEntryType.USAGE_STOP);
    expect(stopped.productBatchRef).toBe('BATCH-001');
  });

  it('EQP-6: cannot start a second usage session while one is already open; cannot stop with no open session', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-002');
    await expect(logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-003')).rejects.toThrow(/already open/);

    await logbookService.logUsageStop(tenantId, equipmentId, actor);
    await expect(logbookService.logUsageStop(tenantId, equipmentId, actor)).rejects.toThrow(/No active usage session/);
  });

  it('EQP-6: cleaning entries log the cleaning type', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const entry = await logbookService.logCleaning(tenantId, equipmentId, actor, 'routine' as never);
    expect(entry.entryType).toBe(LogbookEntryType.CLEANING);
    expect(entry.cleaningType).toBe('routine');
  });

  it('EQP-6/EQP-7: a breakdown report auto-creates a maintenance task and notifies the maintenance role', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const roleModel: Model<RoleDocument> = moduleRef.get(getModelToken(Role.name));
    const maintenanceRoleId = new mongoose.Types.ObjectId();
    await roleModel.create({ _id: maintenanceRoleId, tenantId, name: 'Maintenance Engineer', permissions: ['equipment:edit'] });
    const maintainerUserId = new mongoose.Types.ObjectId();
    const userModel: Model<UserDocument> = moduleRef.get(getModelToken(User.name));
    await userModel.create({ _id: maintainerUserId, tenantId, email: `maint.${maintainerUserId.toString()}@example.com`, fullName: 'Mo Maintainer', passwordHash: await bcrypt.hash('x', 4), roleId: maintenanceRoleId, isActive: true });
    await tenantModel.updateOne({ _id: tenantId }, { $set: { 'settings.maintenanceRoleId': maintenanceRoleId.toString() } });

    const result = await logbookService.logBreakdown(tenantId, equipmentId, actor, 'Pump seal leaking.', null);
    expect(result.entry.entryType).toBe(LogbookEntryType.BREAKDOWN);
    expect(result.maintenanceTask.status).toBe('open');
    expect(result.maintenanceTask.assignedRoleId).toBe(maintenanceRoleId.toString());

    const notificationsService = moduleRef.get(NotificationsService);
    const notifications = await notificationsService.list(tenantId, maintainerUserId.toString(), { page: 1, limit: 20, unreadOnly: false });
    expect(notifications.items).toHaveLength(1);
    expect(notifications.items[0].event).toBe('task_assigned');

    const tasks = await maintenanceService.listForEquipment(tenantId, equipmentId);
    expect(tasks).toHaveLength(1);
  });

  it('EQP-6: a correction is a NEW amendment entry — the original is never edited', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const original = await logbookService.logCleaning(tenantId, equipmentId, actor, 'routine' as never);

    const amendment = await logbookService.createAmendment(tenantId, equipmentId, actor, original.id, 'Wrong cleaning type — should have been Full.');
    expect(amendment.entryType).toBe(LogbookEntryType.AMENDMENT);
    expect(amendment.amendsEntryId).toBe(original.id);

    const originalReloaded = await entryModel.findById(original.id);
    expect(originalReloaded!.cleaningType).toBe('routine'); // untouched

    await expect(entryModel.updateOne({ _id: original.id }, { $set: { cleaningType: 'full' } })).rejects.toThrow('append-only');
  });

  it('EQP-5/EQP-6: usage logging is blocked when the equipment is flagged Do Not Use, and again when Retired', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await equipmentService.setCalibrationLockStatus(tenantId, equipmentId, EquipmentStatus.DO_NOT_USE, actor);
    await expect(logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-004')).rejects.toThrow(/Do Not Use/);

    await equipmentService.setCalibrationLockStatus(tenantId, equipmentId, EquipmentStatus.ACTIVE, actor);
    await equipmentService.transitionStatus(tenantId, equipmentId, EquipmentStatus.RETIRED);
    await expect(logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-005')).rejects.toThrow(/Retired/);
    await expect(logbookService.logCleaning(tenantId, equipmentId, actor, 'full' as never)).rejects.toThrow(/Retired/);
  });

  it('EQP-4/EQP-6: usage logging is blocked when calibration is overdue and the tenant blocks on overdue (default true)', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const calibrationService = moduleRef.get(CalibrationService);
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12, parameters: 'pH buffers', toleranceClass: 'Class A', agencyType: 'internal', nextDueDate: '2000-01-01',
    });

    await expect(logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-006')).rejects.toThrow(/Calibration is overdue/);

    await tenantModel.updateOne({ _id: tenantId }, { $set: { 'settings.blockUsageWhenCalibrationOverdue': false } });
    const allowed = await logbookService.logUsageStart(tenantId, equipmentId, actor, 'BATCH-007');
    expect(allowed.entryType).toBe(LogbookEntryType.USAGE_START);
  });

  it('Iron Rule 5: logbook entries are invisible across tenants', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await logbookService.logCleaning(tenantId, equipmentId, actor, 'routine' as never);
    const otherTenant = id();
    await expect(logbookService.listForEquipment(otherTenant, equipmentId)).rejects.toThrow(AppException);
  });
});
