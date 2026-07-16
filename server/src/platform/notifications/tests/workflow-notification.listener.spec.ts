import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationEvent,
  WhatsAppTemplateKey,
  WorkflowAction,
  WorkflowInstanceStatus,
  type WorkflowStepChangedEvent,
} from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../audit/schemas/audit-event.schema';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { Tenant, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { NOTIFICATION_JOBS } from '../jobs/notification-jobs.interface';
import { NotificationsService } from '../notifications.service';
import { Notification, NotificationDocument, NotificationSchema } from '../schemas/notification.schema';
import { WorkflowNotificationListener } from '../workflow-notification.listener';

describe('PLT-6 workflow event -> notification mapping', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let listener: WorkflowNotificationListener;
  let notificationModel: Model<NotificationDocument>;
  let userModel: Model<UserDocument>;
  let roleModel: Model<RoleDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
        ]),
      ],
      providers: [
        WorkflowNotificationListener,
        NotificationsService,
        AuditService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail: jest.fn() } },
      ],
    }).compile();

    listener = moduleRef.get(WorkflowNotificationListener);
    notificationModel = moduleRef.get(getModelToken(Notification.name));
    userModel = moduleRef.get(getModelToken(User.name));
    roleModel = moduleRef.get(getModelToken(Role.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await notificationModel.collection.deleteMany({});
    await userModel.collection.deleteMany({});
    await roleModel.collection.deleteMany({});
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  async function seedRoleUsers(tenantId: string, roleName: string, count: number, options?: { inactive?: number }) {
    const role = await roleModel.create({ tenantId, name: roleName, permissions: [] });
    const users = [];
    for (let i = 0; i < count; i++) {
      users.push(
        await userModel.create({
          tenantId,
          email: `${roleName.toLowerCase().replace(/\s+/g, '.')}.${i}@example.com`,
          fullName: `${roleName} ${i}`,
          passwordHash: 'irrelevant-hash',
          roleId: role._id,
        }),
      );
    }
    for (let i = 0; i < (options?.inactive ?? 0); i++) {
      await userModel.create({
        tenantId,
        email: `${roleName.toLowerCase().replace(/\s+/g, '.')}.inactive.${i}@example.com`,
        fullName: `${roleName} Inactive ${i}`,
        passwordHash: 'irrelevant-hash',
        roleId: role._id,
        isActive: false,
      });
    }
    return { role, users };
  }

  function baseEvent(tenantId: string, overrides: Partial<WorkflowStepChangedEvent>): WorkflowStepChangedEvent {
    return {
      tenantId,
      entityType: 'Document',
      entityId: 'SOP-QA-001',
      instanceId: id(),
      action: WorkflowAction.SUBMIT,
      fromStatus: WorkflowInstanceStatus.DRAFT,
      toStatus: WorkflowInstanceStatus.IN_PROGRESS,
      fromStepIndex: -1,
      toStepIndex: 0,
      actorId: id(),
      actorFullName: 'Doc Author',
      comment: null,
      toStepRoleId: null,
      toStepName: null,
      overrideAssigneeUserId: null,
      submittedByUserId: null,
      ...overrides,
    };
  }

  it('PLT-6: submit maps to task_assigned for every ACTIVE user holding the first step\'s role', async () => {
    const tenantId = id();
    const { role, users } = await seedRoleUsers(tenantId, 'Dept Head', 2, { inactive: 1 });

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.SUBMIT,
        toStepRoleId: role._id.toString(),
        toStepName: 'Dept Head Review',
        submittedByUserId: id(),
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.event === NotificationEvent.TASK_ASSIGNED)).toBe(true);
    const recipientIds = notifications.map((n) => n.userId.toString()).sort();
    expect(recipientIds).toEqual(users.map((u) => u._id.toString()).sort());
    expect(notifications[0].title).toContain('SOP-QA-001');
    expect(notifications[0].body).toContain('Dept Head Review');

    // PLT-6-WA: task_assigned notifications carry a TASK_ASSIGNED WhatsApp template.
    expect(notifications[0].whatsappTemplateKey).toBe(WhatsAppTemplateKey.TASK_ASSIGNED);
    expect(notifications[0].whatsappTemplateParams).toEqual(['Document', 'SOP-QA-001', 'Dept Head Review']);
  });

  it('PLT-6: a non-final approval maps to task_assigned for the NEXT step\'s role', async () => {
    const tenantId = id();
    const { role } = await seedRoleUsers(tenantId, 'QA Head', 1);

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.APPROVE,
        fromStatus: WorkflowInstanceStatus.IN_PROGRESS,
        toStatus: WorkflowInstanceStatus.IN_PROGRESS,
        fromStepIndex: 0,
        toStepIndex: 1,
        toStepRoleId: role._id.toString(),
        toStepName: 'QA Head Approval',
        submittedByUserId: id(),
        actorFullName: 'Dana Depthead',
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].event).toBe(NotificationEvent.TASK_ASSIGNED);
    expect(notifications[0].body).toContain('QA Head Approval');
  });

  it('PLT-6: the final approval maps to an approved notification for the submitter', async () => {
    const tenantId = id();
    const submitterId = id();

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.APPROVE,
        fromStatus: WorkflowInstanceStatus.IN_PROGRESS,
        toStatus: WorkflowInstanceStatus.APPROVED,
        fromStepIndex: 1,
        toStepIndex: 1,
        submittedByUserId: submitterId,
        actorFullName: 'Quinn Qahead',
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].event).toBe(NotificationEvent.APPROVED);
    expect(notifications[0].userId.toString()).toBe(submitterId);
    expect(notifications[0].body).toContain('Quinn Qahead');

    // PLT-6-WA: the APPROVED notification carries an APPROVAL_COMPLETED WhatsApp template.
    expect(notifications[0].whatsappTemplateKey).toBe(WhatsAppTemplateKey.APPROVAL_COMPLETED);
    expect(notifications[0].whatsappTemplateParams).toEqual(['Document', 'SOP-QA-001', 'Quinn Qahead']);
  });

  it('PLT-6: reject back to DRAFT maps to a rejected notification (with the comment) for the submitter only', async () => {
    const tenantId = id();
    const submitterId = id();

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.REJECT,
        fromStatus: WorkflowInstanceStatus.IN_PROGRESS,
        toStatus: WorkflowInstanceStatus.DRAFT,
        fromStepIndex: 0,
        toStepIndex: -1,
        submittedByUserId: submitterId,
        comment: 'Missing signature page.',
        actorFullName: 'Dana Depthead',
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].event).toBe(NotificationEvent.REJECTED);
    expect(notifications[0].userId.toString()).toBe(submitterId);
    expect(notifications[0].body).toContain('Missing signature page.');

    // PLT-6-WA: REJECTED is not one of the 5 highest-value WhatsApp-mapped events — no template.
    expect(notifications[0].whatsappTemplateKey).toBeNull();
  });

  it('PLT-6: reject to an EARLIER STEP notifies the submitter (rejected) AND re-assigns that step\'s role (task_assigned)', async () => {
    const tenantId = id();
    const submitterId = id();
    const { role, users } = await seedRoleUsers(tenantId, 'Dept Head', 1);

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.REJECT,
        fromStatus: WorkflowInstanceStatus.IN_PROGRESS,
        toStatus: WorkflowInstanceStatus.IN_PROGRESS,
        fromStepIndex: 1,
        toStepIndex: 0,
        toStepRoleId: role._id.toString(),
        toStepName: 'Dept Head Review',
        submittedByUserId: submitterId,
        comment: 'Tolerance table outdated.',
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(2);

    const rejected = notifications.find((n) => n.event === NotificationEvent.REJECTED);
    const assigned = notifications.find((n) => n.event === NotificationEvent.TASK_ASSIGNED);
    expect(rejected?.userId.toString()).toBe(submitterId);
    expect(assigned?.userId.toString()).toBe(users[0]._id.toString());
  });

  it('PLT-6: reassign maps to task_assigned for the substitute user only — not the step\'s whole role', async () => {
    const tenantId = id();
    const substituteId = id();
    // Role users exist but must NOT be notified on a reassign.
    const { role } = await seedRoleUsers(tenantId, 'QA Head', 2);

    await listener.mapEventToNotifications(
      baseEvent(tenantId, {
        action: WorkflowAction.REASSIGN,
        fromStatus: WorkflowInstanceStatus.IN_PROGRESS,
        toStatus: WorkflowInstanceStatus.IN_PROGRESS,
        fromStepIndex: 1,
        toStepIndex: 1,
        toStepRoleId: role._id.toString(),
        toStepName: 'QA Head Approval',
        overrideAssigneeUserId: substituteId,
        submittedByUserId: id(),
        comment: 'QA Head on leave.',
      }),
    );

    const notifications = await notificationModel.find({ tenantId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].event).toBe(NotificationEvent.TASK_ASSIGNED);
    expect(notifications[0].userId.toString()).toBe(substituteId);
  });
});
