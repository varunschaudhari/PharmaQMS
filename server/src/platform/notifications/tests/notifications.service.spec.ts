import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEmailMode, NotificationEvent } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../../audit/schemas/audit-event.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { NOTIFICATION_JOBS } from '../jobs/notification-jobs.interface';
import { NotificationsService } from '../notifications.service';
import { Notification, NotificationDocument, NotificationSchema } from '../schemas/notification.schema';

describe('PLT-6 NotificationsService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let notificationsService: NotificationsService;
  let notificationModel: Model<NotificationDocument>;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantModel: Model<TenantDocument>;
  const enqueueEmail = jest.fn();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
        ]),
      ],
      providers: [
        NotificationsService,
        AuditService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail } },
      ],
    }).compile();

    notificationsService = moduleRef.get(NotificationsService);
    notificationModel = moduleRef.get(getModelToken(Notification.name));
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    // The partial unique dedupe index must exist before concurrency-sensitive tests run (see
    // NumberingService's onModuleInit for the production-side equivalent).
    await notificationModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await notificationModel.collection.deleteMany({});
    await auditEventModel.collection.deleteMany({});
    await tenantModel.collection.deleteMany({});
    enqueueEmail.mockClear();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  function baseInput(tenantId: string, userId: string) {
    return {
      tenantId,
      userId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'Document',
      entityId: 'SOP-QA-001',
      title: 'Approval task: Document SOP-QA-001',
      body: 'Document SOP-QA-001 is awaiting your action.',
    };
  }

  it('PLT-6: notify() creates a per-user log entry and writes an audit event for it', async () => {
    const tenantId = id();
    const userId = id();
    const actor = { userId: id(), fullName: 'Quinn Qahead' };

    const created = await notificationsService.notify({ ...baseInput(tenantId, userId), actor });

    expect(created).not.toBeNull();
    expect(created!.userId).toBe(userId);
    expect(created!.isRead).toBe(false);
    expect(created!.emailedAt).toBeNull();

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Notification' });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].entityId).toBe(created!.id);
    expect(auditEvents[0].actorName).toBe('Quinn Qahead');
  });

  it('PLT-6: notify() with the same dedupeKey for the same user is idempotent — one entry, second call returns null', async () => {
    const tenantId = id();
    const userId = id();
    const input = { ...baseInput(tenantId, userId), dedupeKey: 'due_soon:Equipment:EQP-0042:cal:2026-08-01' };

    const first = await notificationsService.notify(input);
    const second = await notificationsService.notify(input);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await notificationModel.countDocuments({ tenantId })).toBe(1);
  });

  it('PLT-6: the same dedupeKey for two different recipients creates one entry each', async () => {
    const tenantId = id();
    const dedupeKey = 'overdue:Document:SOP-QA-001:review:2026-07-01';

    const employee = await notificationsService.notify({ ...baseInput(tenantId, id()), dedupeKey });
    const deptHead = await notificationsService.notify({ ...baseInput(tenantId, id()), dedupeKey });

    expect(employee).not.toBeNull();
    expect(deptHead).not.toBeNull();
    expect(await notificationModel.countDocuments({ tenantId })).toBe(2);
  });

  it('PLT-6: immediate-mode tenants get an email enqueued; digest-mode tenants do not', async () => {
    const immediateTenant = await tenantModel.create({
      name: 'Immediate Inc',
      slug: `immediate-${id()}`,
      settings: { notificationEmailMode: NotificationEmailMode.IMMEDIATE },
    });
    const digestTenant = await tenantModel.create({
      name: 'Digest Ltd',
      slug: `digest-${id()}`,
      settings: { notificationEmailMode: NotificationEmailMode.DAILY_DIGEST },
    });

    const immediate = await notificationsService.notify(baseInput(immediateTenant._id.toString(), id()));
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(enqueueEmail).toHaveBeenCalledWith(immediate!.id);

    enqueueEmail.mockClear();
    await notificationsService.notify(baseInput(digestTenant._id.toString(), id()));
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('PLT-6: list() returns only the requesting user\'s notifications within their tenant (tenant isolation)', async () => {
    const tenantA = id();
    const tenantB = id();
    const userId = id();

    await notificationsService.notify(baseInput(tenantA, userId));
    // Same user id under a different tenant — must never leak across.
    await notificationsService.notify({ ...baseInput(tenantB, userId), title: 'Tenant B secret' });
    await notificationsService.notify(baseInput(tenantA, id()));

    const page = await notificationsService.list(tenantA, userId, { page: 1, limit: 10, unreadOnly: false });
    expect(page.total).toBe(1);
    expect(page.items[0].title).not.toBe('Tenant B secret');
  });

  it('PLT-6: markRead() flips only the targeted own notifications, and unreadOnly listing reflects it', async () => {
    const tenantId = id();
    const userId = id();

    const first = await notificationsService.notify(baseInput(tenantId, userId));
    await notificationsService.notify(baseInput(tenantId, userId));

    expect(await notificationsService.unreadCount(tenantId, userId)).toBe(2);

    const result = await notificationsService.markRead(tenantId, userId, { notificationIds: [first!.id] });
    expect(result.updated).toBe(1);
    expect(result.before.unread).toBe(2);
    expect(result.after.unread).toBe(1);

    const unread = await notificationsService.list(tenantId, userId, { page: 1, limit: 10, unreadOnly: true });
    expect(unread.total).toBe(1);

    const all = await notificationsService.markRead(tenantId, userId, { all: true });
    expect(all.after.unread).toBe(0);
  });
});
