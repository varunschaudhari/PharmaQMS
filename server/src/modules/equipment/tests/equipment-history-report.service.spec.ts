import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CalibrationResult, QualificationResult, QualificationType } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../../common/storage/file-storage.interface';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleSchema } from '../../../platform/auth/schemas/role.schema';
import { User, UserSchema } from '../../../platform/auth/schemas/user.schema';
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
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationService } from '../calibration.service';
import { EquipmentHistoryReportService } from '../equipment-history-report.service';
import { EquipmentService } from '../equipment.service';
import { LogbookService } from '../logbook.service';
import { MaintenanceService } from '../maintenance.service';
import { PmService } from '../pm.service';
import { QualificationService } from '../qualification.service';
import { CalibrationRecord, CalibrationRecordSchema } from '../schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from '../schemas/equipment.schema';
import { LogbookEntry, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
import { MaintenanceTask, MaintenanceTaskSchema } from '../schemas/maintenance-task.schema';
import { PmPlan, PmPlanSchema } from '../schemas/pm-plan.schema';
import { PmTask, PmTaskDocument, PmTaskSchema } from '../schemas/pm-task.schema';
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

// EQP-10 (SPEC.md §7.3, P1): "show me everything about this machine" — the full-lifecycle
// aggregation report. This test wires the same real EQP-4/6/7/8/9 sub-concern services (against
// mongodb-memory-server, not mocks) that equipment-history-report.service.ts itself depends on,
// same pattern as logbook.service.spec.ts.
describe('EQP-10 EquipmentHistoryReportService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let reportService: EquipmentHistoryReportService;
  let equipmentService: EquipmentService;
  let calibrationService: CalibrationService;
  let qualificationService: QualificationService;
  let pmService: PmService;
  let logbookService: LogbookService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let pmTaskModel: Model<PmTaskDocument>;

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
          { name: PmTask.name, schema: PmTaskSchema },
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
        EquipmentHistoryReportService,
        EquipmentService,
        CalibrationService,
        QualificationService,
        PmService,
        LogbookService,
        MaintenanceService,
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

    reportService = moduleRef.get(EquipmentHistoryReportService);
    equipmentService = moduleRef.get(EquipmentService);
    calibrationService = moduleRef.get(CalibrationService);
    qualificationService = moduleRef.get(QualificationService);
    pmService = moduleRef.get(PmService);
    logbookService = moduleRef.get(LogbookService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    pmTaskModel = moduleRef.get(getModelToken(PmTask.name));
    await pmTaskModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Eddie Engineer' };

  async function seedEquipment(): Promise<{ tenantId: string; equipmentId: string }> {
    const tenantId = id();
    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    await numberingService.createScheme({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    const equipment = await equipmentService.create(tenantId, {
      name: 'Autoclave', location: 'Sterile Suite', departmentId: department._id.toString(), isGmpCritical: true,
    });
    return { tenantId, equipmentId: equipment.id };
  }

  it('EQP-10: aggregates qualification, calibration, PM, logbook, and maintenance data for one equipment', async () => {
    const { tenantId, equipmentId } = await seedEquipment();

    await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.IQ, performedDate: '2026-01-01', result: QualificationResult.PASS },
      { originalname: 'iq-protocol.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF-1.7') },
      null,
    );

    // nextDueDate is set far in the future so the aggregation test below isn't cross-cut by
    // EQP-6's calibrationBlocksUsage enforcement in logUsageStart (that behavior is EQP-4/6's
    // own concern, already covered by calibration.service.spec.ts / logbook.service.spec.ts).
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12, parameters: 'Temperature', toleranceClass: 'Class A', agencyType: 'internal', nextDueDate: '2099-01-01',
    });
    await calibrationService.recordResult(
      tenantId, equipmentId, actor,
      '2026-01-01', CalibrationResult.PASS, null, null,
      { originalname: 'cert.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF-1.7') },
    );

    await pmService.upsertPlan(tenantId, equipmentId, actor, {
      frequencyMonths: 6, checklistText: 'Check belts, lubricate bearings.', nextDueDate: '2020-01-01',
    });

    await logbookService.logUsageStart(tenantId, equipmentId, actor, 'Batch-001');
    await logbookService.logUsageStop(tenantId, equipmentId, actor, 'Batch-001');
    const breakdown = await logbookService.logBreakdown(tenantId, equipmentId, actor, 'Door seal leaking', null);

    const report = await reportService.buildReport(tenantId, equipmentId);

    expect(report.equipment.equipmentCode).toBe('EQP-0001');
    expect(report.qualificationRecords).toHaveLength(1);
    expect(report.qualificationRecords[0].qualificationType).toBe('iq');
    expect(report.calibrationSchedule).not.toBeNull();
    expect(report.calibrationRecords).toHaveLength(1);
    expect(report.pmPlan).not.toBeNull();
    expect(report.pmPlan!.checklistText).toContain('lubricate');
    expect(report.logbookEntries.length).toBeGreaterThanOrEqual(3); // usage-start, usage-stop, breakdown
    expect(report.maintenanceTasks).toHaveLength(1);
    expect(report.maintenanceTasks[0].sourceLogbookEntryId).toBe(breakdown.entry.id);
  });

  it('EQP-10: an equipment with nothing recorded yet still produces a well-formed (empty) report', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const report = await reportService.buildReport(tenantId, equipmentId);
    expect(report.qualificationRecords).toEqual([]);
    expect(report.calibrationSchedule).toBeNull();
    expect(report.calibrationRecords).toEqual([]);
    expect(report.pmPlan).toBeNull();
    expect(report.pmTasks).toEqual([]);
    expect(report.logbookEntries).toEqual([]);
    expect(report.maintenanceTasks).toEqual([]);
  });

  it('EQP-10: generates a real PDF buffer', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const pdf = await reportService.generatePdf(tenantId, equipmentId);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('Iron Rule 5: an equipment cannot be reported on from another tenant', async () => {
    const { equipmentId } = await seedEquipment();
    const otherTenant = id();
    await expect(reportService.buildReport(otherTenant, equipmentId)).rejects.toThrow(AppException);
  });
});
