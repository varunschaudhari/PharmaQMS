import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, SignatureMeaning } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../auth/schemas/role.schema';
import { User, UserDocument } from '../../auth/schemas/user.schema';

describe('PLT-4 Workflow HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let adminToken: string;
  let deptHeadRoleId: string;
  let qaHeadRoleId: string;
  let deptHeadToken: string;
  let qaHeadToken: string;

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email, password });
    return response.body.data.tokens.accessToken as string;
  }

  async function challenge(token: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ credential: password });
    return response.body.data.signingToken as string;
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

    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));

    tenantId = new mongoose.Types.ObjectId().toString();
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
    await userModel.create({
      tenantId,
      email: 'dept.head@example.com',
      fullName: 'Dept Head',
      passwordHash,
      roleId: deptHeadRole._id,
    });

    const qaHeadRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: [] });
    qaHeadRoleId = qaHeadRole._id.toString();
    await userModel.create({
      tenantId,
      email: 'qa.head@example.com',
      fullName: 'QA Head',
      passwordHash,
      roleId: qaHeadRole._id,
    });

    adminToken = await login('admin@example.com', 'Correct1!');
    deptHeadToken = await login('dept.head@example.com', 'Correct1!');
    qaHeadToken = await login('qa.head@example.com', 'Correct1!');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-4: creates a workflow template', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entityType: 'Document',
        name: 'SOP Approval',
        steps: [
          { name: 'Dept Head Review', roleId: deptHeadRoleId, signatureMeaning: SignatureMeaning.REVIEWED_BY, rejectToStepIndex: null },
          { name: 'QA Head Approval', roleId: qaHeadRoleId, signatureMeaning: SignatureMeaning.APPROVED_BY, rejectToStepIndex: 0 },
        ],
      });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body.data.steps).toHaveLength(2);
  });

  it('PLT-4: a non-admin cannot create a workflow template', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Equipment', name: 'EQP Approval', steps: [] });

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-4: full happy path via HTTP — submit, two step approvals with real e-signatures, my-pending-tasks reflects each step', async () => {
    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-1' });
    expect(submitResponse.status).toBe(HttpStatus.CREATED);
    const instanceId = submitResponse.body.data.id;
    expect(submitResponse.body.data.currentStepIndex).toBe(0);

    const deptHeadPending = await request(app.getHttpServer())
      .get('/api/v1/workflow/my-pending-tasks')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    expect(deptHeadPending.body.data.some((task: { id: string }) => task.id === instanceId)).toBe(true);

    const deptHeadSigningToken = await challenge(deptHeadToken, 'Correct1!');
    const firstApprove = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({
        action: 'approve',
        signingToken: deptHeadSigningToken,
        entitySnapshot: { title: 'SOP-1', version: 1 },
      });
    expect(firstApprove.status).toBe(HttpStatus.CREATED);
    expect(firstApprove.body.data.currentStepIndex).toBe(1);
    expect(firstApprove.body.audit).toBeUndefined(); // stripped by AuditTrailInterceptor

    const qaHeadSigningToken = await challenge(qaHeadToken, 'Correct1!');
    const secondApprove = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({
        action: 'approve',
        signingToken: qaHeadSigningToken,
        entitySnapshot: { title: 'SOP-1', version: 1 },
      });
    expect(secondApprove.status).toBe(HttpStatus.CREATED);
    expect(secondApprove.body.data.status).toBe('approved');

    const statusResponse = await request(app.getHttpServer())
      .get(`/api/v1/workflow/instances/${instanceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusResponse.body.data.status).toBe('approved');

    // Both signatures land on the DOCUMENT's own audit-adjacent history (PLT-3), and the workflow
    // step changes land in the document's audit trail (PLT-2) — the two systems compose cleanly.
    const signatures = await request(app.getHttpServer())
      .get('/api/v1/esign/Document/doc-http-1/signatures')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(signatures.body.data).toHaveLength(2);

    const history = await request(app.getHttpServer())
      .get('/api/v1/audit/Document/doc-http-1/history')
      .set('Authorization', `Bearer ${adminToken}`);
    const actions = history.body.data.map((event: { action: string }) => event.action);
    expect(actions).toEqual(expect.arrayContaining(['workflow_submitted', 'workflow_step_approved', 'workflow_approved']));
  });

  it('PLT-4: rejecting with a mandatory comment sends the instance back and is audited with that reason', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-2' });

    const statusResponse = await request(app.getHttpServer())
      .get('/api/v1/workflow/my-pending-tasks')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    const instance = statusResponse.body.data.find((task: { entityId: string }) => task.entityId === 'doc-http-2');

    const rejectResponse = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: 'reject' }); // missing mandatory comment
    expect(rejectResponse.status).toBe(HttpStatus.BAD_REQUEST);
    expect(rejectResponse.body.error.code).toBe('VALIDATION_ERROR');

    const rejectWithComment = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: 'reject', comment: 'Please add the missing section.' });
    expect(rejectWithComment.status).toBe(HttpStatus.CREATED);
    expect(rejectWithComment.body.data.status).toBe('draft');

    const history = await request(app.getHttpServer())
      .get('/api/v1/audit/Document/doc-http-2/history')
      .set('Authorization', `Bearer ${adminToken}`);
    const rejection = history.body.data.find((event: { action: string }) => event.action === 'workflow_rejected');
    expect(rejection.reason).toBe('Please add the missing section.');
  });

  it('PLT-4: a non-assignee is blocked from acting on a step (permission denial)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-3' });

    const pending = await request(app.getHttpServer())
      .get('/api/v1/workflow/my-pending-tasks')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    const instance = pending.body.data.find((task: { entityId: string }) => task.entityId === 'doc-http-3');

    const qaHeadSigningToken = await challenge(qaHeadToken, 'Correct1!');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ action: 'approve', signingToken: qaHeadSigningToken, entitySnapshot: {} });

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-4: reassign requires admin permission and is audited with a reason', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-4' });
    const pending = await request(app.getHttpServer())
      .get('/api/v1/workflow/my-pending-tasks')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    const instance = pending.body.data.find((task: { entityId: string }) => task.entityId === 'doc-http-4');

    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const substituteRole = await roleModel.create({ tenantId, name: 'Substitute Reviewer', permissions: [] });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const substitute = await userModel.create({
      tenantId,
      email: 'substitute@example.com',
      fullName: 'Substitute Reviewer',
      passwordHash,
      roleId: substituteRole._id,
    });
    const substituteToken = await login('substitute@example.com', 'Correct1!');

    const deniedResponse = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: 'reassign', userId: substitute._id.toString(), reason: 'Trying without admin permission' });
    expect(deniedResponse.status).toBe(HttpStatus.FORBIDDEN);

    const reassignResponse = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reassign', userId: substitute._id.toString(), reason: 'Dept head is on leave.' });
    expect(reassignResponse.status).toBe(HttpStatus.CREATED);
    expect(reassignResponse.body.data.overrideAssigneeUserId).toBe(substitute._id.toString());

    // The original role-holder can no longer act — only the reassigned substitute can now.
    const deptHeadSigningToken = await challenge(deptHeadToken, 'Correct1!');
    const blockedOriginal = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: 'approve', signingToken: deptHeadSigningToken, entitySnapshot: {} });
    expect(blockedOriginal.status).toBe(HttpStatus.FORBIDDEN);

    const substituteSigningToken = await challenge(substituteToken, 'Correct1!');
    const substituteApproves = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${instance.id}/act`)
      .set('Authorization', `Bearer ${substituteToken}`)
      .send({ action: 'approve', signingToken: substituteSigningToken, entitySnapshot: {} });
    expect(substituteApproves.status).toBe(HttpStatus.CREATED);
    expect(substituteApproves.body.data.currentStepIndex).toBe(1);

    const history = await request(app.getHttpServer())
      .get('/api/v1/audit/Document/doc-http-4/history')
      .set('Authorization', `Bearer ${adminToken}`);
    const reassignEvent = history.body.data.find((event: { action: string }) => event.action === 'workflow_reassigned');
    expect(reassignEvent.reason).toBe('Dept head is on leave.');
  });

  it('PLT-4: workflow instances are tenant-isolated', async () => {
    const otherTenantId = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const role = await roleModel.create({ tenantId: otherTenantId, name: 'Dept Head', permissions: [] });
    await userModel.create({
      tenantId: otherTenantId,
      email: 'other.dept.head@example.com',
      fullName: 'Other Dept Head',
      passwordHash,
      roleId: role._id,
    });
    const otherToken = await (async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: otherTenantId, email: 'other.dept.head@example.com', password: 'Correct1!' });
      return response.body.data.tokens.accessToken as string;
    })();

    // The other tenant has no workflow template configured for 'Document' at all — submitting a
    // NEW instance under the same entityId is blocked at the template lookup.
    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-1' });
    expect(submitResponse.status).toBe(HttpStatus.NOT_FOUND);

    // Stronger check: the outsider must also be blocked from the PRIMARY tenant's real,
    // already-existing instance by id — not merely unable to create a new one for lack of a
    // template. GET and act (with a well-formed body, so it reaches the tenant check rather than
    // failing DTO validation first) must both 404, proving instanceModel lookups are tenant-scoped.
    const submitOwn = await request(app.getHttpServer())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'Document', entityId: 'doc-http-5' });
    const primaryInstanceId = submitOwn.body.data.id;

    const getForeign = await request(app.getHttpServer())
      .get(`/api/v1/workflow/instances/${primaryInstanceId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(getForeign.status).toBe(HttpStatus.NOT_FOUND);

    const actForeign = await request(app.getHttpServer())
      .post(`/api/v1/workflow/instances/${primaryInstanceId}/act`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ action: 'approve', signingToken: 'irrelevant', entitySnapshot: {} });
    expect(actForeign.status).toBe(HttpStatus.NOT_FOUND);

    // The primary tenant's own view of the same instance is unaffected by the foreign attempts.
    const getOwn = await request(app.getHttpServer())
      .get(`/api/v1/workflow/instances/${primaryInstanceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getOwn.status).toBe(HttpStatus.OK);
    expect(getOwn.body.data.status).toBe('in_progress');
  });
});
