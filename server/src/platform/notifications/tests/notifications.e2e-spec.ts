import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, AuditAction, NotificationEvent, SignatureMeaning } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { AuditEvent, AuditEventDocument } from '../../audit/schemas/audit-event.schema';
import { Role, RoleDocument } from '../../auth/schemas/role.schema';
import { User, UserDocument } from '../../auth/schemas/user.schema';
import { NotificationsService } from '../notifications.service';

describe('PLT-6 Notifications HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let notificationsService: NotificationsService;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let otherTenantId: string;
  let deptHeadUserId: string;
  let adminToken: string;
  let deptHeadToken: string;
  let deptHeadRoleId: string;

  async function login(tenant: string, email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenant, email, password });
    return response.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    notificationsService = moduleFixture.get(NotificationsService);
    auditEventModel = moduleFixture.get<Model<AuditEventDocument>>(getModelToken(AuditEvent.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    otherTenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const adminRole = await roleModel.create({ tenantId, name: 'Tenant Admin', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({
      tenantId,
      email: 'admin@example.com',
      fullName: 'Tenant Admin',
      passwordHash,
      roleId: adminRole._id,
    });

    const deptHeadRole = await roleModel.create({ tenantId, name: 'Dept Head', permissions: [] });
    deptHeadRoleId = deptHeadRole._id.toString();
    const deptHead = await userModel.create({
      tenantId,
      email: 'dept.head@example.com',
      fullName: 'Dept Head',
      passwordHash,
      roleId: deptHeadRole._id,
    });
    deptHeadUserId = deptHead._id.toString();

    adminToken = await login(tenantId, 'admin@example.com', 'Correct1!');
    deptHeadToken = await login(tenantId, 'dept.head@example.com', 'Correct1!');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-6: notification endpoints reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/notifications');
    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-6: GET /notifications returns only the caller\'s own notifications — not other users\', not other tenants\'', async () => {
    await notificationsService.notify({
      tenantId,
      userId: deptHeadUserId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'Document',
      entityId: 'SOP-QA-001',
      title: 'Approval task: Document SOP-QA-001',
      body: 'Awaiting your review.',
    });
    // Another user in the same tenant.
    await notificationsService.notify({
      tenantId,
      userId: new mongoose.Types.ObjectId().toString(),
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'Document',
      entityId: 'SOP-QA-002',
      title: 'Someone else\'s task',
      body: 'Not yours.',
    });
    // Same user id but a different tenant (cross-tenant isolation).
    await notificationsService.notify({
      tenantId: otherTenantId,
      userId: deptHeadUserId,
      event: NotificationEvent.OVERDUE,
      entityType: 'Document',
      entityId: 'SOP-XX-001',
      title: 'Other tenant notification',
      body: 'Must never leak.',
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${deptHeadToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].title).toBe('Approval task: Document SOP-QA-001');
  });

  it('PLT-6: unread-count and mark-read work end-to-end, and mark-read writes an audit event', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    expect(before.body.data.unread).toBeGreaterThanOrEqual(1);

    const markResponse = await request(app.getHttpServer())
      .post('/api/v1/notifications/mark-read')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ all: true });
    expect(markResponse.status).toBe(HttpStatus.CREATED);
    expect(markResponse.body.data.updated).toBeGreaterThanOrEqual(1);

    const after = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    expect(after.body.data.unread).toBe(0);

    // PLT-2: the read-state change was audited (do not mock the audit service in e2e).
    const auditEvents = await auditEventModel.find({
      tenantId,
      entityType: 'Notification',
      entityId: deptHeadUserId,
      action: AuditAction.UPDATE,
    });
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('PLT-6: submitting a workflow via HTTP produces a task_assigned notification for the first step\'s assignee (listener wiring)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entityType: 'DummyRecord',
        name: 'Dummy Approval',
        steps: [
          {
            name: 'Dept Head Review',
            roleId: deptHeadRoleId,
            signatureMeaning: SignatureMeaning.REVIEWED_BY,
            rejectToStepIndex: null,
          },
        ],
      })
      .expect(HttpStatus.CREATED);

    await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'DummyRecord', entityId: 'DR-e2e-1' })
      .expect(HttpStatus.CREATED);

    // The listener runs off the (synchronously emitted, asynchronously handled) event — poll
    // briefly rather than racing it.
    let found = false;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${deptHeadToken}`);
      found = (response.body.data as Array<{ entityId: string; event: string }>).some(
        (n) => n.entityId === 'DR-e2e-1' && n.event === NotificationEvent.TASK_ASSIGNED,
      );
      if (!found) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(found).toBe(true);
  });
});
