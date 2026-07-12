import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { QualificationResult, QualificationType } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../../common/storage/file-storage.interface';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from '../schemas/equipment.schema';
import { EquipmentService } from '../equipment.service';
import { LogbookEntry, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
import { PmPlan, PmPlanSchema } from '../schemas/pm-plan.schema';
import { QualificationService } from '../qualification.service';
import { QualificationRecord, QualificationRecordDocument, QualificationRecordSchema } from '../schemas/qualification-record.schema';

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

describe('EQP-8 QualificationService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let qualificationService: QualificationService;
  let equipmentService: EquipmentService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let recordModel: Model<QualificationRecordDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.APP_BASE_URL = 'https://qms.example.com';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [qrConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Equipment.name, schema: EquipmentSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: CalibrationSchedule.name, schema: CalibrationScheduleSchema },
          { name: LogbookEntry.name, schema: LogbookEntrySchema },
          { name: QualificationRecord.name, schema: QualificationRecordSchema },
          { name: PmPlan.name, schema: PmPlanSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
        ]),
      ],
      providers: [
        QualificationService,
        EquipmentService,
        NumberingService,
        QrService,
        PdfRenderService,
        AuditService,
        { provide: FILE_STORAGE, useValue: new MemoryFileStorage() },
      ],
    }).compile();

    qualificationService = moduleRef.get(QualificationService);
    equipmentService = moduleRef.get(EquipmentService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    recordModel = moduleRef.get(getModelToken(QualificationRecord.name));
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

  function protocolFile() {
    return { originalname: 'protocol.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('PROTOCOL') };
  }
  function reportFile() {
    return { originalname: 'report.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('REPORT') };
  }

  it('EQP-8: records an IQ event with just a protocol (report optional)', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const record = await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.IQ, performedDate: '2026-01-01', result: QualificationResult.PASS },
      protocolFile(), null,
    );
    expect(record.qualificationType).toBe(QualificationType.IQ);
    expect(record.protocolFileName).toBe('protocol.pdf');
    expect(record.reportFileName).toBeNull();
    expect(record.requalificationFrequencyMonths).toBeNull(); // not PQ/REQUALIFICATION
  });

  it('EQP-8: a PASSed PQ with a requalification frequency sets the equipment-level summary; attaching a report afterward works exactly once', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const record = await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.PQ, performedDate: '2026-01-01', result: QualificationResult.PASS, requalificationFrequencyMonths: 24 },
      protocolFile(), null,
    );
    expect(record.reportFileName).toBeNull();

    const summary = await qualificationService.getSummary(tenantId, equipmentId);
    expect(summary.hasPassedQualification).toBe(true);
    expect(summary.nextRequalificationDueDate).not.toBeNull();
    expect(new Date(summary.nextRequalificationDueDate!).getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());

    const withReport = await qualificationService.attachReport(tenantId, equipmentId, record.id, actor, reportFile());
    expect(withReport.reportFileName).toBe('report.pdf');

    await expect(qualificationService.attachReport(tenantId, equipmentId, record.id, actor, reportFile())).rejects.toThrow(
      /already been attached/,
    );
  });

  it('EQP-8: a FAILed PQ does not set a requalification due date even if a frequency is supplied', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.PQ, performedDate: '2026-01-01', result: QualificationResult.FAIL, requalificationFrequencyMonths: 24 },
      protocolFile(), null,
    );
    const summary = await qualificationService.getSummary(tenantId, equipmentId);
    expect(summary.hasPassedQualification).toBe(false);
    expect(summary.nextRequalificationDueDate).toBeNull();
  });

  it('EQP-8: an IQ/OQ PASS does not set a requalification schedule (only PQ/REQUALIFICATION do)', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.OQ, performedDate: '2026-01-01', result: QualificationResult.PASS, requalificationFrequencyMonths: 12 },
      protocolFile(), null,
    );
    const summary = await qualificationService.getSummary(tenantId, equipmentId);
    expect(summary.hasPassedQualification).toBe(false);
  });

  it('EQP-8: listRequalificationSchedule reflects every equipment with a due date on the calendar', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.PQ, performedDate: '2020-01-01', result: QualificationResult.PASS, requalificationFrequencyMonths: 12 },
      protocolFile(), null,
    );
    const schedule = await qualificationService.listRequalificationSchedule(tenantId);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].equipmentId).toBe(equipmentId);
  });

  it('EQP-8: file content-type/size validation rejects an invalid protocol upload', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await expect(
      qualificationService.recordQualification(
        tenantId, equipmentId, actor,
        { qualificationType: QualificationType.IQ, performedDate: '2026-01-01', result: QualificationResult.PASS },
        { originalname: 'x.exe', mimetype: 'application/x-msdownload', size: 10, buffer: Buffer.from('x') },
        null,
      ),
    ).rejects.toThrow(/Only PDF, JPEG, or PNG/);
  });

  it('Iron Rule 5: qualification records are invisible across tenants', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await qualificationService.recordQualification(
      tenantId, equipmentId, actor,
      { qualificationType: QualificationType.IQ, performedDate: '2026-01-01', result: QualificationResult.PASS },
      protocolFile(), null,
    );
    const otherTenant = id();
    await expect(qualificationService.listForEquipment(otherTenant, equipmentId)).rejects.toThrow(AppException);
    const records = await recordModel.find({ tenantId: otherTenant });
    expect(records).toHaveLength(0);
  });
});
