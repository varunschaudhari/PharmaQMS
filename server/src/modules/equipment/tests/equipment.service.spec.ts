import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CalibrationStatus, EquipmentStatus } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { ConfigModule } from '@nestjs/config';
import { EquipmentService } from '../equipment.service';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentDocument, EquipmentSchema } from '../schemas/equipment.schema';
import { LogbookEntry, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
import { PmPlan, PmPlanSchema } from '../schemas/pm-plan.schema';
import { QualificationRecord, QualificationRecordSchema } from '../schemas/qualification-record.schema';

describe('EQP-1 EQP-2 EQP-3 EquipmentService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let equipmentService: EquipmentService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let equipmentModel: Model<EquipmentDocument>;

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
      providers: [EquipmentService, NumberingService, QrService, PdfRenderService, AuditService],
    }).compile();

    equipmentService = moduleRef.get(EquipmentService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    equipmentModel = moduleRef.get(getModelToken(Equipment.name));
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
    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    await numberingService.createScheme({
      tenantId,
      entityType: 'EQUIPMENT',
      prefix: 'EQP',
      useDepartmentToken: false,
      paddingWidth: 4,
      yearlyReset: false,
    });
    return { tenantId, departmentId: department._id.toString() };
  }

  it('EQP-1: creates equipment with a numbered code, ACTIVE by default', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const equipment = await equipmentService.create(tenantId, {
      name: 'pH Meter',
      make: 'Mettler Toledo',
      modelName: 'SevenCompact',
      serialNumber: 'SN-001',
      location: 'QC Lab — Bench 3',
      departmentId,
      isGmpCritical: true,
      installDate: '2024-01-15',
    });

    expect(equipment.equipmentCode).toBe('EQP-0001');
    expect(equipment.status).toBe(EquipmentStatus.ACTIVE);
    expect(equipment.isGmpCritical).toBe(true);
    expect(equipment.make).toBe('Mettler Toledo');
    expect(equipment.modelName).toBe('SevenCompact');
  });

  it('EQP-2: every created equipment gets a QR code with a working scan URL', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const equipment = await equipmentService.create(tenantId, {
      name: 'Balance',
      location: 'QC Lab',
      departmentId,
      isGmpCritical: false,
    });

    expect(equipment.qr).not.toBeNull();
    expect(equipment.qr!.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(equipment.qr!.scanUrl).toBe(`https://qms.example.com/s/${equipment.qr!.code}`);
  });

  it('EQP-1: rejects creation against an unknown department', async () => {
    const tenantId = id();
    await numberingService.createScheme({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    await expect(
      equipmentService.create(tenantId, { name: 'X', location: 'Y', departmentId: id(), isGmpCritical: false }),
    ).rejects.toThrow('Department not found.');
  });

  it('EQP-1: status transitions follow the explicit map — Active → Under Maintenance → Active is fine, Retired → Active is not', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const equipment = await equipmentService.create(tenantId, { name: 'Autoclave', location: 'Sterile Suite', departmentId, isGmpCritical: true });

    const underMaintenance = await equipmentService.transitionStatus(tenantId, equipment.id, EquipmentStatus.UNDER_MAINTENANCE);
    expect(underMaintenance.after.status).toBe(EquipmentStatus.UNDER_MAINTENANCE);

    const backToActive = await equipmentService.transitionStatus(tenantId, equipment.id, EquipmentStatus.ACTIVE);
    expect(backToActive.after.status).toBe(EquipmentStatus.ACTIVE);

    const retired = await equipmentService.transitionStatus(tenantId, equipment.id, EquipmentStatus.RETIRED);
    expect(retired.after.status).toBe(EquipmentStatus.RETIRED);

    await expect(equipmentService.transitionStatus(tenantId, equipment.id, EquipmentStatus.ACTIVE)).rejects.toThrow(
      AppException,
    );
    const reloaded = await equipmentModel.findById(equipment.id);
    expect(reloaded!.status).toBe(EquipmentStatus.RETIRED);
  });

  it('EQP-3: the status card reports NOT_SCHEDULED calibration and role-gated action stubs', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const equipment = await equipmentService.create(tenantId, { name: 'Balance', location: 'QC Lab', departmentId, isGmpCritical: true });

    const operatorCard = await equipmentService.getStatusCard(tenantId, equipment.id, {
      userId: id(),
      fullName: 'Olive Operator',
      permissions: [],
    });
    expect(operatorCard.calibrationStatus).toBe(CalibrationStatus.NOT_SCHEDULED);
    expect(operatorCard.qualificationStatus).toBe('not_qualified');
    expect(operatorCard.pmDueDate).toBeNull();
    expect(operatorCard.recentLogbookEntries).toEqual([]);
    expect(operatorCard.availableActions).toEqual(['log_usage', 'log_cleaning', 'report_breakdown']);

    const qaCard = await equipmentService.getStatusCard(tenantId, equipment.id, {
      userId: id(),
      fullName: 'Quinn Qahead',
      permissions: ['equipment:approve'],
    });
    expect(qaCard.availableActions).toEqual(
      expect.arrayContaining(['log_usage', 'record_calibration', 'complete_pm']),
    );
  });

  it('EQP-1: list supports status/department filters and search, tenant-scoped', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const eq1 = await equipmentService.create(tenantId, { name: 'pH Meter Alpha', location: 'QC Lab', departmentId, isGmpCritical: true });
    await equipmentService.create(tenantId, { name: 'Balance Beta', location: 'QC Lab', departmentId, isGmpCritical: false });
    await equipmentService.transitionStatus(tenantId, eq1.id, EquipmentStatus.UNDER_MAINTENANCE);

    const maintenanceOnly = await equipmentService.list(tenantId, { page: 1, limit: 20, status: EquipmentStatus.UNDER_MAINTENANCE });
    expect(maintenanceOnly.total).toBe(1);
    expect(maintenanceOnly.items[0].name).toBe('pH Meter Alpha');

    const searchResult = await equipmentService.list(tenantId, { page: 1, limit: 20, search: 'Beta' });
    expect(searchResult.total).toBe(1);
    expect(searchResult.items[0].name).toBe('Balance Beta');
  });

  it('Iron Rule 5: equipment is invisible across tenants', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const equipment = await equipmentService.create(tenantId, { name: 'Centrifuge', location: 'Lab', departmentId, isGmpCritical: false });
    const otherTenant = id();

    await expect(equipmentService.get(otherTenant, equipment.id)).rejects.toThrow('Equipment not found.');
    const list = await equipmentService.list(otherTenant, { page: 1, limit: 20 });
    expect(list.total).toBe(0);
  });
});
