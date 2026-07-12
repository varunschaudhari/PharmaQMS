import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PmTaskStatus } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
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
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from '../schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from '../schemas/equipment.schema';
import { EquipmentService } from '../equipment.service';
import { LogbookEntry, LogbookEntrySchema } from '../schemas/logbook-entry.schema';
import { PmPlan, PmPlanDocument, PmPlanSchema } from '../schemas/pm-plan.schema';
import { PmService } from '../pm.service';
import { PmTask, PmTaskDocument, PmTaskSchema } from '../schemas/pm-task.schema';
import { QualificationRecord, QualificationRecordSchema } from '../schemas/qualification-record.schema';

describe('EQP-9 PmService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let pmService: PmService;
  let equipmentService: EquipmentService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let planModel: Model<PmPlanDocument>;
  let taskModel: Model<PmTaskDocument>;

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
          { name: LogbookEntry.name, schema: LogbookEntrySchema },
          { name: QualificationRecord.name, schema: QualificationRecordSchema },
          { name: PmPlan.name, schema: PmPlanSchema },
          { name: PmTask.name, schema: PmTaskSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
        ]),
      ],
      providers: [PmService, EquipmentService, NumberingService, QrService, PdfRenderService, AuditService, EsignService],
    }).compile();

    pmService = moduleRef.get(PmService);
    equipmentService = moduleRef.get(EquipmentService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    planModel = moduleRef.get(getModelToken(PmPlan.name));
    taskModel = moduleRef.get(getModelToken(PmTask.name));
    // Mongoose builds indexes asynchronously in the background; the idempotency test below
    // relies on the (tenantId, planId, dueDate) unique index actually existing for its second
    // insert to be rejected — await index creation explicitly (same pattern used for TRN-1's
    // TrainingAssignment/DocumentTrainingTarget models).
    await taskModel.init();
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

  it('EQP-9: creates a PM plan and reports it back', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    const { after } = await pmService.upsertPlan(tenantId, equipmentId, actor, {
      frequencyMonths: 6, checklistText: 'Check belts, lubricate bearings, inspect seals.', nextDueDate: '2026-01-01',
    });
    expect(after.frequencyMonths).toBe(6);
    const fetched = await pmService.getPlan(tenantId, equipmentId);
    expect(fetched!.checklistText).toContain('lubricate');
  });

  it('EQP-9: generateTaskIfDue is idempotent (unique index guards a duplicate due-cycle)', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await pmService.upsertPlan(tenantId, equipmentId, actor, { frequencyMonths: 6, checklistText: 'Checklist.', nextDueDate: '2020-01-01' });
    const plan = await planModel.findOne({ tenantId, equipmentId });

    const now = new Date('2026-01-01');
    const first = await pmService.generateTaskIfDue(tenantId, plan!, now);
    expect(first).not.toBeNull();
    expect(first!.status).toBe(PmTaskStatus.OPEN);

    const second = await pmService.generateTaskIfDue(tenantId, plan!, now);
    expect(second).toBeNull(); // already generated for this due cycle

    const tasks = await taskModel.find({ tenantId, equipmentId });
    expect(tasks).toHaveLength(1);
  });

  it('EQP-9: generateTaskIfDue does nothing before the due date arrives', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await pmService.upsertPlan(tenantId, equipmentId, actor, { frequencyMonths: 6, checklistText: 'Checklist.', nextDueDate: '2099-01-01' });
    const plan = await planModel.findOne({ tenantId, equipmentId });
    const result = await pmService.generateTaskIfDue(tenantId, plan!, new Date('2026-01-01'));
    expect(result).toBeNull();
  });

  it('EQP-9 / Iron Rule 4: completing a task is an e-signature and advances the plan\'s nextDueDate', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await pmService.upsertPlan(tenantId, equipmentId, actor, { frequencyMonths: 3, checklistText: 'Checklist.', nextDueDate: '2020-01-01' });
    const plan = await planModel.findOne({ tenantId, equipmentId });
    const task = await pmService.generateTaskIfDue(tenantId, plan!, new Date('2026-01-01'));

    const completed = await pmService.completeTask(tenantId, task!.id, { userId: actor.userId, tenantId, fullName: actor.fullName }, 'Serviced per checklist.');
    expect(completed.status).toBe(PmTaskStatus.COMPLETED);
    expect(completed.completionNote).toBe('Serviced per checklist.');

    const updatedPlan = await planModel.findOne({ tenantId, equipmentId });
    expect(updatedPlan!.nextDueDate.getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());

    const esignService = moduleRef.get(EsignService);
    const signatures = await esignService.findForEntity(tenantId, 'Equipment', equipmentId);
    expect(signatures.some((s) => s.meaning === 'pm_completed')).toBe(true);

    await expect(
      pmService.completeTask(tenantId, task!.id, { userId: actor.userId, tenantId, fullName: actor.fullName }, 'Again.'),
    ).rejects.toThrow(/already been completed/);
  });

  it('EQP-9: listOpenTasks / listTasksForEquipment reflect status correctly', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await pmService.upsertPlan(tenantId, equipmentId, actor, { frequencyMonths: 3, checklistText: 'Checklist.', nextDueDate: '2020-01-01' });
    const plan = await planModel.findOne({ tenantId, equipmentId });
    await pmService.generateTaskIfDue(tenantId, plan!, new Date('2026-01-01'));

    const open = await pmService.listOpenTasks(tenantId);
    expect(open).toHaveLength(1);
    const all = await pmService.listTasksForEquipment(tenantId, equipmentId);
    expect(all).toHaveLength(1);
  });

  it('Iron Rule 5: PM plans/tasks are invisible across tenants', async () => {
    const { tenantId, equipmentId } = await seedEquipment();
    await pmService.upsertPlan(tenantId, equipmentId, actor, { frequencyMonths: 3, checklistText: 'Checklist.', nextDueDate: '2020-01-01' });
    const otherTenant = id();
    await expect(pmService.getPlan(otherTenant, equipmentId)).rejects.toThrow(AppException);
    expect(await pmService.listOpenTasks(otherTenant)).toEqual([]);
  });
});
