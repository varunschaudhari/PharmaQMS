import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceTaskStatus } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
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
import { Tenant, TenantDocument, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { MaintenanceService } from '../maintenance.service';
import { MaintenanceTask, MaintenanceTaskDocument, MaintenanceTaskSchema } from '../schemas/maintenance-task.schema';

describe('EQP-7 MaintenanceService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let maintenanceService: MaintenanceService;
  let tenantModel: Model<TenantDocument>;
  let roleModel: Model<RoleDocument>;
  let userModel: Model<UserDocument>;
  let taskModel: Model<MaintenanceTaskDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [esignConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: MaintenanceTask.name, schema: MaintenanceTaskSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: Role.name, schema: RoleSchema },
          { name: User.name, schema: UserSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [
        MaintenanceService,
        AuditService,
        EsignService,
        NotificationsService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail: jest.fn() } },
      ],
    }).compile();

    maintenanceService = moduleRef.get(MaintenanceService);
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    roleModel = moduleRef.get(getModelToken(Role.name));
    userModel = moduleRef.get(getModelToken(User.name));
    taskModel = moduleRef.get(getModelToken(MaintenanceTask.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const actor = { userId: id(), fullName: 'Eddie Engineer' };
  const equipmentSnapshot = { id: id(), equipmentCode: 'EQP-0001', name: 'pH Meter' };

  async function seedTenant(requireMaintenanceVerification: boolean, maintenanceRoleId: string | null): Promise<string> {
    const tenantId = id();
    await tenantModel.create({ _id: tenantId, name: 'Acme Pharma', slug: `acme-${tenantId}`, settings: { requireMaintenanceVerification, maintenanceRoleId } });
    return tenantId;
  }

  it('EQP-7: creates a task snapshotting the tenant maintenance-role + verification settings, and notifies each role holder', async () => {
    const roleId = id();
    const tenantId = await seedTenant(true, roleId);
    await roleModel.create({ _id: roleId, tenantId, name: 'Maintenance Engineer', permissions: ['equipment:edit'] });
    const maintainerId = id();
    await userModel.create({ _id: maintainerId, tenantId, email: `m.${maintainerId}@example.com`, fullName: 'Mo Maintainer', passwordHash: await bcrypt.hash('x', 4), roleId, isActive: true });

    const task = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    expect(task.status).toBe(MaintenanceTaskStatus.OPEN);
    expect(task.assignedRoleId).toBe(roleId);
    expect(task.verificationRequired).toBe(true);
    expect(task.equipmentCode).toBe('EQP-0001');

    const notificationsService = moduleRef.get(NotificationsService);
    const notifications = await notificationsService.list(tenantId, maintainerId, { page: 1, limit: 20, unreadOnly: false });
    expect(notifications.items).toHaveLength(1);
  });

  it('EQP-7: with verification required, closing moves to PENDING_VERIFICATION, then QA verification e-signs and closes it', async () => {
    const tenantId = await seedTenant(true, null);
    const task = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);

    const closed = await maintenanceService.close(tenantId, task.id, actor, 'Replaced the pump seal.');
    expect(closed.status).toBe(MaintenanceTaskStatus.PENDING_VERIFICATION);
    expect(closed.engineerCompletionNote).toBe('Replaced the pump seal.');

    await expect(maintenanceService.close(tenantId, task.id, actor, 'Second attempt.')).rejects.toThrow(/already been closed/);

    const qa = { userId: id(), tenantId, fullName: 'Quinn Qahead' };
    const verified = await maintenanceService.verify(tenantId, task.id, qa, 'Confirmed fixed.');
    expect(verified.status).toBe(MaintenanceTaskStatus.CLOSED);
    expect(verified.verifiedByUserId).toBe(qa.userId);

    const esignService = moduleRef.get(EsignService);
    const signatures = await esignService.findForEntity(tenantId, 'Equipment', equipmentSnapshot.id);
    expect(signatures.some((s) => s.meaning === 'verified_by')).toBe(true);

    await expect(maintenanceService.verify(tenantId, task.id, qa, 'Again.')).rejects.toThrow(/not awaiting verification/);
  });

  it('EQP-7: with verification NOT required, closing goes straight to CLOSED (no verify step)', async () => {
    const tenantId = await seedTenant(false, null);
    const task = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);

    const closed = await maintenanceService.close(tenantId, task.id, actor, 'Fixed on the spot.');
    expect(closed.status).toBe(MaintenanceTaskStatus.CLOSED);

    const qa = { userId: id(), tenantId, fullName: 'Quinn Qahead' };
    await expect(maintenanceService.verify(tenantId, task.id, qa, null)).rejects.toThrow(/not awaiting verification/);
  });

  it('EQP-7: listOpen only returns OPEN/PENDING_VERIFICATION tasks, tenant-scoped', async () => {
    const tenantId = await seedTenant(true, null);
    const openTask = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    const closedTask = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    await maintenanceService.close(tenantId, closedTask.id, actor, 'Done.');
    await maintenanceService.verify(tenantId, closedTask.id, { userId: id(), tenantId, fullName: 'QA' }, null);

    const open = await maintenanceService.listOpen(tenantId);
    expect(open.map((t) => t.id)).toEqual([openTask.id]);
  });

  it('Iron Rule 5: maintenance tasks are invisible across tenants', async () => {
    const tenantId = await seedTenant(true, null);
    await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    const otherTenant = id();
    expect(await maintenanceService.listOpen(otherTenant)).toEqual([]);
    const task = await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    await expect(maintenanceService.close(otherTenant, task.id, actor, 'x')).rejects.toThrow(AppException);
  });

  it('sanity: taskModel is queryable directly (fixture wiring check)', async () => {
    const tenantId = await seedTenant(true, null);
    await maintenanceService.createTaskFromBreakdown(tenantId, equipmentSnapshot, id(), actor);
    expect(await taskModel.countDocuments({ tenantId })).toBeGreaterThan(0);
  });
});
