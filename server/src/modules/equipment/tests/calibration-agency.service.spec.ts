import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CalibrationAgencyStatus, CalibrationResult, CalibrationStatus } from '@pharmaqms/shared';
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
import { Department, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationAgencyService } from '../calibration-agency.service';
import { CalibrationService } from '../calibration.service';
import { EquipmentService } from '../equipment.service';
import { CalibrationAgency, CalibrationAgencySchema } from '../schemas/calibration-agency.schema';
import { CalibrationRecord, CalibrationRecordSchema } from '../schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
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

describe('EQP-11 CalibrationAgencyService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let agencyService: CalibrationAgencyService;
  let calibrationService: CalibrationService;
  let equipmentService: EquipmentService;
  let numberingService: NumberingService;
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
          { name: CalibrationAgency.name, schema: CalibrationAgencySchema },
          { name: LogbookEntry.name, schema: LogbookEntrySchema },
          { name: QualificationRecord.name, schema: QualificationRecordSchema },
          { name: PmPlan.name, schema: PmPlanSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
        ]),
      ],
      providers: [
        CalibrationAgencyService,
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

    agencyService = moduleRef.get(CalibrationAgencyService);
    calibrationService = moduleRef.get(CalibrationService);
    equipmentService = moduleRef.get(EquipmentService);
    numberingService = moduleRef.get(NumberingService);
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Quinn Qahead' };

  async function seedEquipment(): Promise<{ tenantId: string; departmentId: string; equipmentId: string }> {
    const tenantId = id();
    const departmentModel = moduleRef.get(getModelToken(Department.name));
    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: `QC${id().slice(-4)}` });
    await numberingService.createScheme({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    const equipment = await equipmentService.create(tenantId, { name: 'pH Meter', location: 'QC Lab', departmentId: department._id.toString(), isGmpCritical: true });
    return { tenantId, departmentId: department._id.toString(), equipmentId: equipment.id };
  }

  function certificate() {
    return { originalname: 'nabl-cert.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('PDF') };
  }

  it('EQP-11: creates an agency, updates it, and uploads an accreditation certificate', async () => {
    const tenantId = id();
    const agency = await agencyService.create(tenantId, { name: 'Cal-Labs Inc', accreditationNumber: 'NABL-12345', accreditationValidUntil: '2099-01-01' }, actor);
    expect(agency.status).toBe(CalibrationAgencyStatus.ACTIVE);
    expect(agency.accreditationNumber).toBe('NABL-12345');

    const { after } = await agencyService.update(tenantId, agency.id, { contactName: 'Rita Rao' }, actor);
    expect(after.contactName).toBe('Rita Rao');

    const withCertificate = await agencyService.uploadCertificate(tenantId, agency.id, actor, certificate());
    expect(withCertificate.certificates).toHaveLength(1);
    expect(withCertificate.certificates[0].fileName).toBe('nabl-cert.pdf');

    const file = await agencyService.getCertificateFile(tenantId, agency.id, withCertificate.certificates[0].id);
    expect(file.fileName).toBe('nabl-cert.pdf');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'CalibrationAgency', action: 'calibration_certificate_uploaded' });
    expect(auditEvents).toHaveLength(1);
  });

  it('EQP-11: status transitions follow the explicit map and are reversible', async () => {
    const tenantId = id();
    const agency = await agencyService.create(tenantId, { name: 'Precision Cal Co' }, actor);

    const suspended = await agencyService.transitionStatus(tenantId, agency.id, CalibrationAgencyStatus.SUSPENDED, actor);
    expect(suspended.after.status).toBe(CalibrationAgencyStatus.SUSPENDED);

    const reactivated = await agencyService.transitionStatus(tenantId, agency.id, CalibrationAgencyStatus.ACTIVE, actor);
    expect(reactivated.after.status).toBe(CalibrationAgencyStatus.ACTIVE);
  });

  it('EQP-11: rejects linking a calibration schedule to an unknown agency', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await expect(
      calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
        frequencyMonths: 12,
        parameters: 'pH buffers',
        toleranceClass: 'Class A',
        agencyType: 'external',
        agencyId: id(),
        nextDueDate: '2026-01-01',
      }),
    ).rejects.toThrow(AppException);
  });

  it('EQP-11 (c): the agency-wise due list groups DUE_SOON/OVERDUE schedules by agency', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const agency = await agencyService.create(tenantId, { name: 'Metro Cal Services' }, actor);
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'external',
      agencyId: agency.id,
      nextDueDate: '2020-01-01',
    });

    const due = await agencyService.listDueByAgency(tenantId);
    expect(due).toHaveLength(1);
    expect(due[0].agencyId).toBe(agency.id);
    expect(due[0].calibrationStatus).toBe(CalibrationStatus.OVERDUE);
    expect(due[0].accreditationExpired).toBe(false);

    const csv = await agencyService.exportDueByAgencyCsv(tenantId);
    expect(csv).toContain('Metro Cal Services');

    const pdf = await agencyService.generateDueByAgencyPdf(tenantId);
    expect(pdf.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
  });

  it('EQP-11 (d): expired accreditation flags the audited calibration record with a warning, but never blocks recording', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const agency = await agencyService.create(tenantId, { name: 'Lapsed Cal Co', accreditationValidUntil: '2000-01-01' }, actor);
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'external',
      agencyId: agency.id,
      nextDueDate: '2026-01-01',
    });

    const record = await calibrationService.recordResult(tenantId, equipmentId, actor, '2026-01-01', CalibrationResult.PASS, null, null, certificate());
    expect(record.status).toBeDefined(); // recording succeeded — no block

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: 'calibration_recorded' });
    const changesJson = JSON.stringify(auditEvents[auditEvents.length - 1].changes);
    expect(changesJson).toContain('accreditationExpiredWarning');
  });

  it('EQP-11 (e): the certificate registry is filterable by agency and equipment', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const agency = await agencyService.create(tenantId, { name: 'Registry Cal Co' }, actor);
    await calibrationService.upsertSchedule(tenantId, equipmentId, actor, {
      frequencyMonths: 12,
      parameters: 'pH buffers',
      toleranceClass: 'Class A',
      agencyType: 'external',
      agencyId: agency.id,
      nextDueDate: '2026-01-01',
    });
    await calibrationService.recordResult(tenantId, equipmentId, actor, '2026-01-01', CalibrationResult.PASS, null, null, certificate());

    const all = await agencyService.listCertificates(tenantId, {});
    expect(all).toHaveLength(1);
    expect(all[0].agencyName).toBe('Registry Cal Co');

    const byAgency = await agencyService.listCertificates(tenantId, { agencyId: agency.id });
    expect(byAgency).toHaveLength(1);

    const byOtherAgency = await agencyService.listCertificates(tenantId, { agencyId: id() });
    expect(byOtherAgency).toHaveLength(0);

    const byEquipment = await agencyService.listCertificates(tenantId, { equipmentId });
    expect(byEquipment).toHaveLength(1);
  });

  it('Iron Rule 5: agencies are invisible across tenants', async () => {
    const tenantId = id();
    const agency = await agencyService.create(tenantId, { name: 'Cross Tenant Cal Co' }, actor);
    const otherTenant = id();

    await expect(agencyService.get(otherTenant, agency.id)).rejects.toThrow('Calibration agency not found.');
    const list = await agencyService.list(otherTenant);
    expect(list).toHaveLength(0);
  });
});
