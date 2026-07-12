import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, SignatureMeaning, WorkflowAction } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';

// TRN-1..TRN-5 driven end-to-end through the REAL Documents module (DOC-9 distribution, DOC-3
// approval to Effective) — nothing about the Training module is reachable except via genuine
// cross-module events, which is exactly what this proves is wired correctly.
describe('TRN-1 TRN-2 TRN-3 TRN-4 TRN-5 Training HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let storageDir: string;
  let tenantId: string;
  let departmentId: string;
  let adminToken: string;
  let deptHeadToken: string;
  let qaHeadToken: string;
  let operatorRoleId: string;
  let operatorToken: string;
  let operatorUserId: string;
  let outsiderToken: string;

  const PASSWORD = 'Correct1!';
  const server = () => app.getHttpServer();

  async function login(tenant: string, email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId: tenant, email, password: PASSWORD });
    return response.body.data.tokens.accessToken as string;
  }

  async function challenge(token: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ credential: PASSWORD });
    return response.body.data.signingToken as string;
  }

  async function approveDocumentToEffective(documentId: string, versionId: string): Promise<void> {
    const pending = await request(server()).get('/api/v1/workflow/my-pending-tasks').set('Authorization', `Bearer ${deptHeadToken}`);
    const task = (pending.body.data as Array<{ id: string; entityId: string }>).find((t) => t.entityId === versionId);
    const instanceId = task!.id;
    const t1 = await challenge(deptHeadToken);
    await request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ action: WorkflowAction.APPROVE, signingToken: t1, entitySnapshot: {} });
    const t2 = await challenge(qaHeadToken);
    await request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ action: WorkflowAction.APPROVE, signingToken: t2, entitySnapshot: {} });

    for (let attempt = 0; attempt < 30; attempt++) {
      const versions = await request(server()).get(`/api/v1/documents/${documentId}/versions`).set('Authorization', `Bearer ${adminToken}`);
      const version = (versions.body.data as Array<{ id: string; state: string }>).find((v) => v.id === versionId);
      if (version?.state === 'effective') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('version never became effective');
  }

  async function waitForAssignment(token: string, docNumber: string, timeoutMs = 5000): Promise<{ id: string; versionLabel: string; status: string } | undefined> {
    const start = Date.now();
    for (;;) {
      const response = await request(server()).get('/api/v1/training/my-assignments').set('Authorization', `Bearer ${token}`);
      const found = (response.body.data as Array<{ id: string; docNumber: string; versionLabel: string; status: string }>).find(
        (a) => a.docNumber === docNumber,
      );
      if (found) return found;
      if (Date.now() - start > timeoutMs) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function waitForAssignmentVersion(
    token: string,
    docNumber: string,
    versionLabel: string,
    timeoutMs = 5000,
  ): Promise<{ id: string; versionLabel: string; status: string } | undefined> {
    const start = Date.now();
    for (;;) {
      const response = await request(server()).get('/api/v1/training/my-assignments').set('Authorization', `Bearer ${token}`);
      const found = (response.body.data as Array<{ id: string; docNumber: string; versionLabel: string; status: string }>).find(
        (a) => a.docNumber === docNumber && a.versionLabel === versionLabel,
      );
      if (found) return found;
      if (Date.now() - start > timeoutMs) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    storageDir = mkdtempSync(join(tmpdir(), 'pharmaqms-trn-e2e-'));
    process.env.FILE_STORAGE_DIR = storageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const departmentModel = moduleFixture.get<Model<DepartmentDocument>>(getModelToken(Department.name));
    const schemeModel = moduleFixture.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const authorRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'author@example.com', fullName: 'QA Executive', passwordHash, roleId: authorRole._id });
    const deptHeadRole = await roleModel.create({ tenantId, name: 'Dept Head', permissions: [] });
    await userModel.create({ tenantId, email: 'dh@example.com', fullName: 'Dana Depthead', passwordHash, roleId: deptHeadRole._id });
    const qaHeadRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: [] });
    await userModel.create({ tenantId, email: 'qh@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaHeadRole._id });

    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    operatorRoleId = operatorRole._id.toString();
    const operatorUser = await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });
    operatorUserId = operatorUser._id.toString();

    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'SOP', prefix: 'SOP', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false });

    const otherTenant = new mongoose.Types.ObjectId().toString();
    // Grants training:view so the isolation test below exercises tenant scoping, not permission
    // denial — an empty result for a real cross-tenant query, not a 403.
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ['training:view'] });
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });

    adminToken = await login(tenantId, 'author@example.com');
    deptHeadToken = await login(tenantId, 'dh@example.com');
    qaHeadToken = await login(tenantId, 'qh@example.com');
    operatorToken = await login(tenantId, 'operator@example.com');
    outsiderToken = await login(otherTenant, 'outsider@else.example');

    await request(server())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entityType: 'DocumentVersion',
        name: 'SOP Review & Approval',
        steps: [
          { name: 'Dept Head Review', roleId: deptHeadRole._id.toString(), signatureMeaning: SignatureMeaning.REVIEWED_BY, rejectToStepIndex: null },
          { name: 'QA Head Approval', roleId: qaHeadRole._id.toString(), signatureMeaning: SignatureMeaning.APPROVED_BY, rejectToStepIndex: 0 },
        ],
      });
  }, 180000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('DOC-9 + TRN-1: setting a document\'s distribution to a role auto-generates a pending assignment once it is Effective', async () => {
    const created = await request(server())
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Gowning procedure')
      .field('docType', 'sop')
      .field('departmentId', departmentId)
      .field('reviewFrequencyMonths', '12')
      .attach('file', Buffer.from('%PDF-1.4 gowning'), { filename: 'gowning.pdf', contentType: 'application/pdf' });
    expect(created.status).toBe(HttpStatus.CREATED);
    const documentId = created.body.data.id as string;
    const v1Id = created.body.data.latestVersion.id as string;

    const distribution = await request(server())
      .patch(`/api/v1/documents/${documentId}/distribution`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [operatorRoleId], departmentIds: [] });
    expect(distribution.status).toBe(HttpStatus.OK);
    expect(distribution.body.data.distributionRoleIds).toEqual([operatorRoleId]);

    // No Effective version yet — nothing to assign.
    expect(await waitForAssignment(operatorToken, 'SOP-QA-001', 1000)).toBeUndefined();

    await request(server()).post(`/api/v1/documents/${documentId}/versions/${v1Id}/submit`).set('Authorization', `Bearer ${adminToken}`);
    await approveDocumentToEffective(documentId, v1Id);

    const assignment = await waitForAssignment(operatorToken, 'SOP-QA-001');
    expect(assignment).toBeDefined();
    expect(assignment!.status).toBe('pending');
    expect(assignment!.versionLabel).toBe('1.0');
  });

  it('TRN-2: the operator reads and e-signs "Trained — read and understood" to complete it', async () => {
    const assignment = await waitForAssignment(operatorToken, 'SOP-QA-001');
    const signingToken = await challenge(operatorToken);

    const complete = await request(server())
      .post(`/api/v1/training/assignments/${assignment!.id}/complete`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ signingToken });
    expect(complete.status).toBe(HttpStatus.CREATED);
    expect(complete.body.data.status).toBe('completed');

    const signatures = await request(server())
      .get(`/api/v1/esign/TrainingAssignment/${assignment!.id}/signatures`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(signatures.body.data).toHaveLength(1);
    expect(signatures.body.data[0].meaning).toBe(SignatureMeaning.TRAINED_READ_AND_UNDERSTOOD);
  });

  it('TRN-2: a signing-token-less (session-only) completion attempt is rejected — Iron Rule 4', async () => {
    const listResponse = await request(server()).get('/api/v1/training/my-assignments').set('Authorization', `Bearer ${operatorToken}`);
    const anyAssignment = (listResponse.body.data as Array<{ id: string }>)[0];
    const response = await request(server())
      .post(`/api/v1/training/assignments/${anyAssignment.id}/complete`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ signingToken: '' });
    // SignatureGuard rejects a missing/empty signing token before the service even runs.
    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('TRN-3: a new Effective version (v2.0) flips the completed assignment back to a fresh pending task', async () => {
    const documents = await request(server()).get('/api/v1/documents').set('Authorization', `Bearer ${adminToken}`);
    const document = (documents.body.data as Array<{ id: string; docNumber: string }>).find((d) => d.docNumber === 'SOP-QA-001')!;

    const v2 = await request(server())
      .post(`/api/v1/documents/${document.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('bump', 'major')
      .field('changeSummary', 'Updated gowning sequence for Grade B.')
      .attach('file', Buffer.from('%PDF-1.4 gowning v2'), { filename: 'gowning-v2.pdf', contentType: 'application/pdf' });
    const v2Id = v2.body.data.id as string;
    await request(server()).post(`/api/v1/documents/${document.id}/versions/${v2Id}/submit`).set('Authorization', `Bearer ${adminToken}`);
    await approveDocumentToEffective(document.id, v2Id);

    // The retarget happens off an async event handler (EventEmitter2.emit() does not await async
    // listeners) — poll rather than asserting on the very next tick.
    const v2Row = await waitForAssignmentVersion(operatorToken, 'SOP-QA-001', '2.0');
    expect(v2Row).toBeDefined();
    expect(v2Row!.status).toBe('pending'); // "status flips to training due"

    const listResponse = await request(server()).get('/api/v1/training/my-assignments').set('Authorization', `Bearer ${operatorToken}`);
    const v1Row = (listResponse.body.data as Array<{ versionLabel: string; status: string }>).find((a) => a.versionLabel === '1.0');
    expect(v1Row!.status).toBe('completed'); // untouched history
  });

  it('TRN-4: the employee record (JSON + PDF) is reachable by the employee themself and shows the full history', async () => {
    const jsonResponse = await request(server())
      .get(`/api/v1/training/employees/${operatorUserId}/record`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(jsonResponse.status).toBe(HttpStatus.OK);
    expect((jsonResponse.body.data as unknown[]).length).toBeGreaterThanOrEqual(2);

    const pdfResponse = await request(server())
      .get(`/api/v1/training/employees/${operatorUserId}/record.pdf`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdfResponse.status).toBe(HttpStatus.OK);
    expect(pdfResponse.headers['content-type']).toBe('application/pdf');
    expect((pdfResponse.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 30000);

  it('TRN-4: another operator cannot view this employee\'s record without training:view', async () => {
    const otherOperator = await request(server())
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'operator2@example.com', fullName: 'Otto Operator', password: PASSWORD, roleId: operatorRoleId });
    const otherToken = await login(tenantId, 'operator2@example.com');

    const response = await request(server())
      .get(`/api/v1/training/employees/${operatorUserId}/record`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    void otherOperator;
  });

  it('TRN-1: the training matrix shows the document with correct assignment/completion counts', async () => {
    // Otto's own assignment (TRN-1 auto-generation on role assignment, previous test) is created
    // by the same async event handler as TRN-3's retarget — poll instead of asserting immediately.
    let entry: { docNumber: string; totalAssigned: number; totalCompleted: number } | undefined;
    const start = Date.now();
    do {
      const response = await request(server()).get('/api/v1/training/matrix').set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(HttpStatus.OK);
      entry = (response.body.data as Array<{ docNumber: string; totalAssigned: number; totalCompleted: number }>).find(
        (e) => e.docNumber === 'SOP-QA-001',
      );
      if (entry && entry.totalAssigned >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() - start < 5000);

    // Operator: v1.0 (completed) + v2.0 (pending); Otto (added to the same role afterwards,
    // TRN-1 auto-generation) got his own v2.0 pending row — 3 rows, 1 completed.
    expect(entry!.totalAssigned).toBe(3);
    expect(entry!.totalCompleted).toBe(1);
  });

  it('PLT-8 tenant isolation: an outsider sees no assignments and cannot reach this tenant\'s training data', async () => {
    const assignments = await request(server()).get('/api/v1/training/my-assignments').set('Authorization', `Bearer ${outsiderToken}`);
    expect(assignments.body.data).toEqual([]);

    const matrix = await request(server()).get('/api/v1/training/matrix').set('Authorization', `Bearer ${outsiderToken}`);
    expect(matrix.body.data).toEqual([]);
  });
});
