import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, NotificationEvent, SignatureMeaning, WorkflowAction } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';

// SPEC.md §8 Phase 0 definition of done: "a dummy 'test record' can be created, routed through
// a 2-step approval with e-signs, every action visible in its history tab, QR resolves to it."
// This suite drives that entire journey over real HTTP with nothing mocked.
describe('Phase 0 gate — PLT-1 PLT-2 PLT-3 PLT-4 PLT-5 PLT-6 PLT-7 PLT-8 integration', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let roleModel: Model<RoleDocument>;
  let userModel: Model<UserDocument>;

  let tenantId: string;
  let adminToken: string;
  let deptHeadToken: string;
  let qaHeadToken: string;
  let operatorToken: string;
  let outsiderToken: string;

  let recordId: string;
  let recordNumber: string;
  let qrCode: string;
  let instanceId: string;

  const PASSWORD = 'Correct1!';

  const server = () => app.getHttpServer();

  async function login(tenant: string, email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId: tenant, email, password: PASSWORD });
    expect([HttpStatus.OK, HttpStatus.CREATED]).toContain(response.status);
    return response.body.data.tokens.accessToken as string;
  }

  async function challenge(token: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ credential: PASSWORD });
    expect([HttpStatus.OK, HttpStatus.CREATED]).toContain(response.status);
    return response.body.data.signingToken as string;
  }

  async function pollForNotification(token: string, predicate: (n: { event: string; entityId: string }) => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await request(server()).get('/api/v1/notifications?limit=50').set('Authorization', `Bearer ${token}`);
      if ((response.body.data as Array<{ event: string; entityId: string }>).some(predicate)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));
    userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));

    // PLT-8: platform admin is a documented direct-DB bootstrap; it then provisions the tenant
    // (and its admin) over HTTP.
    const bootstrapTenant = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const bootstrapRole = await roleModel.create({ tenantId: bootstrapTenant, name: 'Bootstrap', permissions: [] });
    await userModel.create({
      tenantId: bootstrapTenant,
      email: 'platform.admin@gate.example',
      fullName: 'Platform Admin',
      passwordHash,
      roleId: bootstrapRole._id,
      isPlatformAdmin: true,
    });
    const platformAdminToken = await login(bootstrapTenant, 'platform.admin@gate.example');

    const tenantResponse = await request(server())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        name: 'Gate Pharma',
        slug: 'gate-pharma',
        initialAdmin: { email: 'admin@gate.example', fullName: 'Gate Admin', password: PASSWORD },
      });
    expect(tenantResponse.status).toBe(HttpStatus.CREATED);
    tenantId = tenantResponse.body.data.id as string;
    adminToken = await login(tenantId, 'admin@gate.example');

    // Roles still have no HTTP surface (flagged since PLT-4) — seed the two approver roles and
    // a permissionless operator directly, then create their users through the audited PLT-8 API.
    const deptHeadRole = await roleModel.create({ tenantId, name: 'Dept Head', permissions: [] });
    const qaHeadRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: [] });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });

    for (const [email, fullName, roleId] of [
      ['dept.head@gate.example', 'Dana Depthead', deptHeadRole._id],
      ['qa.head@gate.example', 'Quinn Qahead', qaHeadRole._id],
      ['operator@gate.example', 'Olive Operator', operatorRole._id],
    ] as const) {
      const userResponse = await request(server())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, fullName, password: PASSWORD, roleId: roleId.toString() });
      expect(userResponse.status).toBe(HttpStatus.CREATED);
    }

    deptHeadToken = await login(tenantId, 'dept.head@gate.example');
    qaHeadToken = await login(tenantId, 'qa.head@gate.example');
    operatorToken = await login(tenantId, 'operator@gate.example');

    // A second tenant for isolation checks.
    const outsiderTenant = new mongoose.Types.ObjectId().toString();
    const outsiderRole = await roleModel.create({ tenantId: outsiderTenant, name: 'Outsider', permissions: [] });
    await userModel.create({
      tenantId: outsiderTenant,
      email: 'outsider@else.example',
      fullName: 'Outsider',
      passwordHash,
      roleId: outsiderRole._id,
    });
    outsiderToken = await login(outsiderTenant, 'outsider@else.example');

    // PLT-5: numbering scheme; PLT-4: 2-step approval template.
    const schemeResponse = await request(server())
      .post('/api/v1/numbering/schemes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'TEST-RECORD', prefix: 'TR', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });
    expect(schemeResponse.status).toBe(HttpStatus.CREATED);

    const templateResponse = await request(server())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entityType: 'TestRecord',
        name: 'Test Record Approval',
        steps: [
          { name: 'Dept Head Review', roleId: deptHeadRole._id.toString(), signatureMeaning: SignatureMeaning.REVIEWED_BY, rejectToStepIndex: null },
          { name: 'QA Head Approval', roleId: qaHeadRole._id.toString(), signatureMeaning: SignatureMeaning.APPROVED_BY, rejectToStepIndex: 0 },
        ],
      });
    expect(templateResponse.status).toBe(HttpStatus.CREATED);
  }, 120000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-5 + PLT-7: creating a record assigns TR-0001 from the numbering service and mints its QR identity', async () => {
    const response = await request(server())
      .post('/api/v1/test-records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Cleaning validation dummy record', description: 'Phase 0 definition-of-done demo.' });

    expect(response.status).toBe(HttpStatus.CREATED);
    recordId = response.body.data.id;
    recordNumber = response.body.data.recordNumber;
    qrCode = response.body.data.qr.code;

    expect(recordNumber).toBe('TR-0001');
    expect(qrCode).toMatch(/^[A-Z2-9]{10}$/);
    expect(response.body.data.qr.scanUrl).toContain(`/s/${qrCode}`);
    expect(response.body.data.workflow).toBeNull();
  });

  it('PLT-1: a user without admin permission cannot create records (RBAC)', async () => {
    const response = await request(server())
      .post('/api/v1/test-records')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ title: 'Not allowed', description: 'Operator lacks admin:create.' });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-2: editing the record writes a field-level old→new diff into its history', async () => {
    const response = await request(server())
      .patch(`/api/v1/test-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Cleaning validation dummy record (rev A)' });
    expect(response.status).toBe(HttpStatus.OK);

    const history = await request(server())
      .get(`/api/v1/audit/TestRecord/${recordId}/history?limit=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    const updateEvent = (history.body.data as Array<{ action: string; changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> }>).find(
      (event) => event.action === AuditAction.UPDATE,
    );
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.changes).toEqual([
      expect.objectContaining({
        field: 'title',
        oldValue: 'Cleaning validation dummy record',
        newValue: 'Cleaning validation dummy record (rev A)',
      }),
    ]);
  });

  it('PLT-4 + PLT-6: submitting routes it into the 2-step approval and notifies the first assignee', async () => {
    const response = await request(server())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'TestRecord', entityId: recordId });
    expect(response.status).toBe(HttpStatus.CREATED);
    instanceId = response.body.data.id;
    expect(response.body.data.currentStep.name).toBe('Dept Head Review');

    const record = await request(server())
      .get(`/api/v1/test-records/${recordId}`)
      .set('Authorization', `Bearer ${deptHeadToken}`);
    expect(record.body.data.workflow.status).toBe('in_progress');

    expect(
      await pollForNotification(deptHeadToken, (n) => n.event === NotificationEvent.TASK_ASSIGNED && n.entityId === recordId),
    ).toBe(true);
  });

  it('PLT-3 + PLT-4: two real e-signatures carry the record to APPROVED; session-only signing is rejected', async () => {
    // Iron Rule 4: a valid session alone must not sign.
    const noTokenAttempt = await request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: WorkflowAction.APPROVE, signingToken: '', entitySnapshot: {} });
    expect(noTokenAttempt.status).toBe(HttpStatus.BAD_REQUEST);

    const deptHeadSigning = await challenge(deptHeadToken);
    const step1 = await request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: WorkflowAction.APPROVE, signingToken: deptHeadSigning, entitySnapshot: { recordNumber } });
    expect(step1.status).toBe(HttpStatus.CREATED);
    expect(step1.body.data.currentStep.name).toBe('QA Head Approval');

    const qaHeadSigning = await challenge(qaHeadToken);
    const step2 = await request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ action: WorkflowAction.APPROVE, signingToken: qaHeadSigning, entitySnapshot: { recordNumber } });
    expect(step2.status).toBe(HttpStatus.CREATED);
    expect(step2.body.data.status).toBe('approved');

    const signatures = await request(server())
      .get(`/api/v1/esign/TestRecord/${recordId}/signatures`)
      .set('Authorization', `Bearer ${adminToken}`);
    const meanings = (signatures.body.data as Array<{ meaning: string }>).map((s) => s.meaning).sort();
    expect(meanings).toEqual([SignatureMeaning.APPROVED_BY, SignatureMeaning.REVIEWED_BY].sort());
  });

  it('PLT-6: the submitting author is notified of the final approval', async () => {
    expect(
      await pollForNotification(adminToken, (n) => n.event === NotificationEvent.APPROVED && n.entityId === recordId),
    ).toBe(true);
  });

  it('PLT-2: the full journey is visible in the record\'s history — create, edit, submit, both approvals', async () => {
    const history = await request(server())
      .get(`/api/v1/audit/TestRecord/${recordId}/history?limit=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    const actions = (history.body.data as Array<{ action: string }>).map((event) => event.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CREATE,
        AuditAction.UPDATE,
        AuditAction.WORKFLOW_SUBMITTED,
        AuditAction.WORKFLOW_STEP_APPROVED,
        AuditAction.WORKFLOW_APPROVED,
      ]),
    );
  });

  it('PLT-7: the QR code resolves to the record for tenant users — and its mobile scan URL is stable', async () => {
    const response = await request(server())
      .get(`/api/v1/qr/resolve/${qrCode}`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data).toMatchObject({ entityType: 'TestRecord', entityId: recordId, entityCode: 'TR-0001' });
  });

  it('PLT-8: tenant isolation holds end-to-end — an outsider can neither read the record nor resolve its QR', async () => {
    const recordAttempt = await request(server())
      .get(`/api/v1/test-records/${recordId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(recordAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const qrAttempt = await request(server())
      .get(`/api/v1/qr/resolve/${qrCode}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(qrAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const listAttempt = await request(server())
      .get('/api/v1/test-records')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(listAttempt.body.data).toEqual([]);
  });
});
