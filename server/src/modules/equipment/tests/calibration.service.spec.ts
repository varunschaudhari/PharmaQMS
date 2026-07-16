import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CalibrationDispositionOutcome,
  CalibrationRecordStatus,
  CalibrationResult,
  EquipmentStatus,
} from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../../common/storage/file-storage.interface';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { esignConfig } from '../../../platform/esign/config/esign.config';
import { EsignService } from '../../../platform/esign/esign.service';
import { Signature, SignatureSchema } from '../../../platform/esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../../platform/esign/schemas/signing-token-usage.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { User, UserSchema } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationService } from '../calibration.service';
import { EquipmentService } from '../equipment.service';
import { CalibrationAgency, CalibrationAgencySchema } from '../schemas/calibration-agency.schema';
import { CalibrationRecord, CalibrationRecordDocument, CalibrationRecordSchema } from '../schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleDocument, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from '../schemas/equipment.schema';
import { LogbookEntry, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
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

describe('EQP-4 EQP-5 CalibrationService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let calibrationService: CalibrationService;
  let equipmentService: EquipmentService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let scheduleModel: Model<CalibrationScheduleDocument>;
  let recordModel: Model<CalibrationRecordDocument>;
  let tenantModel: Model<TenantDocument>;
  let auditEventModel: Model<AuditEventDocument>;

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
          { name: CalibrationSchedule.name, schema: CalibrationScheduleSchema },
          { name: CalibrationRecord.name, schema: CalibrationRecordSchema },
          { name: LogbookEntry.name, schema: LogbookEntrySchema },
          { name: QualificationRecord.name, schema: QualificationRecordSchema },
          { name: PmPlan.name, schema: PmPlanSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
          { name: CalibrationAgency.name, schema: CalibrationAgencySchema },
        ]),
      ],
      providers: [
        CalibrationService,
        EquipmentService,
        NumberingService,
        QrService,
        PdfRenderService,
        AuditService,
        EsignService,
        { provide: FILE_STORAGE, useValue: new MemoryFileStorage() },
      ],
    }).compile();

    calibrationService = moduleRef.get(CalibrationService);
    equipmentService = moduleRef.get(EquipmentService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    scheduleModel = moduleRef.get(getModelToken(CalibrationSchedule.name));
    recordModel = moduleRef.get(getModelToken(CalibrationRecord.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Eddie Engineer' };
  const qa = { userId: id(), tenantId: '', fullName: 'Quinn Qahead' };

  async function seedEquipment(): Promise<{ tenantId: string; departmentId: string; equipmentId: string }> {
    const tenantId = id();
    await tenantModel.create({ _id: tenantId, name: 'Acme Pharma', slug: `acme-${tenantId}` });
    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    await numberingService.createScheme({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    const equipment = await equipmentService.create(tenantId, {
      name: 'pH Meter',
      location: 'QC Lab',
      departmentId: department._id.toString(),
      isGmpCritical: true,
    });
    return { tenantId, departmentId: department._id.toString(), equipmentId: equipment.id };
  }

  function certificate() {
    return { originalname: 'cert.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('PDF') };
  }

  it('EQP-4: creates a calibration schedule and reports it back', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const { after } = await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH 4/7/10 buffers',
      toleranceClass: 'Class A',
      agencyType: 'external',
      agencyName: 'Cal-Labs Inc',
      nextDueDate: '2026-01-01',
    });
    expect(after.frequencyMonths).toBe(12);
    expect(after.agencyName).toBe('Cal-Labs Inc');

    const schedule = await scheduleModel.findOne({ tenantId, equipmentId });
    expect(schedule).not.toBeNull();
  });

  it('EQP-4: recording a result requires an existing schedule', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await expect(
      calibrationService.recordResult(tenantId, equipmentId, actor, '2026-01-01', CalibrationResult.PASS, null, null, certificate()),
    ).rejects.toThrow(/No calibration schedule/);
  });

  it('EQP-4: a PASS result can be QA-verified and advances the schedule nextDueDate', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 6,
      parameters: 'Weight set 1-200g',
      toleranceClass: 'Class F1',
      agencyType: 'internal',
      nextDueDate: '2026-01-01',
    });

    const record = await calibrationService.recordResult(
      tenantId,
      equipmentId,
      actor,
      '2026-01-01',
      CalibrationResult.PASS,
      'All within tolerance.',
      null,
      certificate(),
    );
    expect(record.status).toBe(CalibrationRecordStatus.PENDING_QA_VERIFICATION);

    const verified = await calibrationService.verify(tenantId, equipmentId, record.id, {
      userId: qa.userId,
      tenantId,
      fullName: qa.fullName,
    });
    expect(verified.status).toBe(CalibrationRecordStatus.VERIFIED);

    const schedule = await scheduleModel.findOne({ tenantId, equipmentId });
    expect(schedule!.nextDueDate.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());

    const equipment = await equipmentService.get(tenantId, equipmentId);
    expect(equipment.status).toBe(EquipmentStatus.ACTIVE);

    const signatures = await moduleRef.get(EsignService).findForEntity(tenantId, 'Equipment', equipmentId);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].meaning).toBe('verified_by');
  });

  it('EQP-5: a FAIL/OOT result immediately quarantines the equipment (Do Not Use), before any QA action', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 6,
      parameters: 'Weight set 1-200g',
      toleranceClass: 'Class F1',
      agencyType: 'internal',
      nextDueDate: '2026-01-01',
    });

    await expect(
      calibrationService.recordResult(tenantId, equipmentId, actor, '2026-01-01', CalibrationResult.FAIL, null, null, certificate()),
    ).rejects.toThrow(/impact-assessment note is required/);

    const record = await calibrationService.recordResult(
      tenantId,
      equipmentId,
      actor,
      '2026-01-01',
      CalibrationResult.FAIL,
      null,
      'Reading drifted 8% beyond tolerance — assessing impact on recent batches.',
      certificate(),
    );
    expect(record.status).toBe(CalibrationRecordStatus.PENDING_QA_VERIFICATION);
    expect(record.impactAssessmentNote).toMatch(/drifted/);

    const equipment = await equipmentService.get(tenantId, equipmentId);
    expect(equipment.status).toBe(EquipmentStatus.DO_NOT_USE);

    // EQP-1: the generic status endpoint may not touch DO_NOT_USE either way.
    await expect(
      equipmentService.transitionStatus(tenantId, equipmentId, EquipmentStatus.UNDER_MAINTENANCE),
    ).rejects.toThrow(AppException);

    // Verifying a FAIL result is rejected — only disposition applies to it.
    await expect(
      calibrationService.verify(tenantId, equipmentId, record.id, { userId: qa.userId, tenantId, fullName: qa.fullName }),
    ).rejects.toThrow(/Only a PASS/);
  });

  it('EQP-5: QA disposition "release" returns the equipment to Active; nextDueDate is untouched', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 6,
      parameters: 'Weight set 1-200g',
      toleranceClass: 'Class F1',
      agencyType: 'internal',
      nextDueDate: '2026-01-01',
    });
    const before = await scheduleModel.findOne({ tenantId, equipmentId });

    const record = await calibrationService.recordResult(
      tenantId,
      equipmentId,
      actor,
      '2026-01-01',
      CalibrationResult.FAIL,
      null,
      'Impact assessed as low risk — batches unaffected.',
      certificate(),
    );

    const dispositioned = await calibrationService.disposition(
      tenantId,
      equipmentId,
      record.id,
      { userId: qa.userId, tenantId, fullName: qa.fullName },
      { signingToken: 'unused-in-unit-test', outcome: CalibrationDispositionOutcome.RELEASE, note: 'Risk assessed as acceptable; releasing.' },
    );
    expect(dispositioned.status).toBe(CalibrationRecordStatus.DISPOSITIONED);

    const equipment = await equipmentService.get(tenantId, equipmentId);
    expect(equipment.status).toBe(EquipmentStatus.ACTIVE);

    const after = await scheduleModel.findOne({ tenantId, equipmentId });
    expect(after!.nextDueDate.getTime()).toBe(before!.nextDueDate.getTime());

    const signatures = await moduleRef.get(EsignService).findForEntity(tenantId, 'Equipment', equipmentId);
    expect(signatures.some((s) => s.meaning === 'qa_disposition')).toBe(true);

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: 'calibration_dispositioned' });
    expect(auditEvents).toHaveLength(1);
  });

  it('EQP-5: QA disposition "retain_do_not_use" keeps the equipment quarantined', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 6,
      parameters: 'Weight set 1-200g',
      toleranceClass: 'Class F1',
      agencyType: 'internal',
      nextDueDate: '2026-01-01',
    });
    const record = await calibrationService.recordResult(
      tenantId,
      equipmentId,
      actor,
      '2026-01-01',
      CalibrationResult.FAIL,
      null,
      'Severe drift — retaining quarantine pending deviation investigation.',
      certificate(),
    );

    await calibrationService.disposition(
      tenantId,
      equipmentId,
      record.id,
      { userId: qa.userId, tenantId, fullName: qa.fullName },
      {
        signingToken: 'unused-in-unit-test',
        outcome: CalibrationDispositionOutcome.RETAIN_DO_NOT_USE,
        note: 'Retaining quarantine pending investigation.',
        deviationRef: 'DEV-0001',
      },
    );

    const equipment = await equipmentService.get(tenantId, equipmentId);
    expect(equipment.status).toBe(EquipmentStatus.DO_NOT_USE);

    const stored = await recordModel.findById(record.id);
    expect(stored!.deviationRef).toBe('DEV-0001');

    // Dispositioning twice is rejected.
    await expect(
      calibrationService.disposition(
        tenantId,
        equipmentId,
        record.id,
        { userId: qa.userId, tenantId, fullName: qa.fullName },
        { signingToken: 'unused-in-unit-test', outcome: CalibrationDispositionOutcome.RELEASE, note: 'Second attempt.' },
      ),
    ).rejects.toThrow(/already been dispositioned/);
  });

  it('EQP-4: the calibration-due dashboard lists only DUE_SOON/OVERDUE schedules', async () => {
    const { tenantId, departmentId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'internal',
      nextDueDate: '2000-01-01',
    });
    const farFutureEquipment = await equipmentService.create(tenantId, {
      name: 'Balance',
      location: 'QC Lab',
      departmentId,
      isGmpCritical: false,
    });
    const farFutureEquipmentId = farFutureEquipment.id;
    await calibrationService.upsertSchedule(tenantId, farFutureEquipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'internal',
      nextDueDate: '2099-01-01',
    });

    const due = await calibrationService.listDue(tenantId);
    expect(due).toHaveLength(1);
    expect(due[0].equipmentId).toBe(equipmentId);
    expect(due[0].calibrationStatus).toBe('overdue');
  });

  it('Iron Rule 5: calibration schedules/records are invisible across tenants', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'internal',
      nextDueDate: '2026-01-01',
    });
    const otherTenant = id();
    await expect(calibrationService.getSchedule(otherTenant, equipmentId)).rejects.toThrow(AppException);
    const due = await calibrationService.listDue(otherTenant);
    expect(due).toHaveLength(0);
  });
});
