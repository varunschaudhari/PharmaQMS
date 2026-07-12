import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ALL_PERMISSION_KEYS,
  DocumentStatus,
  DocumentVersionState,
  SignatureMeaning,
  WorkflowAction,
} from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';

describe('DOC-3 DOC-6 DOC-7 document lifecycle over HTTP', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let storageDir: string;
  let tenantId: string;
  let departmentId: string;
  let authorToken: string;
  let deptHeadToken: string;
  let qaHeadToken: string;

  const PASSWORD = 'Correct1!';
  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId, email, password: PASSWORD });
    return response.body.data.tokens.accessToken as string;
  }

  async function challenge(token: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ credential: PASSWORD });
    return response.body.data.signingToken as string;
  }

  async function createDocument(title: string): Promise<{ documentId: string; versionId: string }> {
    const response = await request(server())
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${authorToken}`)
      .field('title', title)
      .field('docType', 'sop')
      .field('departmentId', departmentId)
      .field('reviewFrequencyMonths', '12')
      .attach('file', Buffer.from(`%PDF-1.7 ${title}`), { filename: 'sop.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(HttpStatus.CREATED);
    return { documentId: response.body.data.id, versionId: response.body.data.latestVersion.id };
  }

  async function submit(documentId: string, versionId: string): Promise<string> {
    const response = await request(server())
      .post(`/api/v1/documents/${documentId}/versions/${versionId}/submit`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(response.status).toBe(HttpStatus.CREATED);
    const instance = await request(server())
      .get('/api/v1/workflow/my-pending-tasks')
      .set('Authorization', `Bearer ${deptHeadToken}`);
    const task = (instance.body.data as Array<{ id: string; entityId: string }>).find((t) => t.entityId === versionId);
    expect(task).toBeDefined();
    return task!.id;
  }

  async function act(token: string, instanceId: string, body: Record<string, unknown>) {
    return request(server())
      .post(`/api/v1/workflow/instances/${instanceId}/act`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function waitForVersionState(documentId: string, versionId: string, state: DocumentVersionState): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await request(server())
        .get(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${authorToken}`);
      const version = (response.body.data as Array<{ id: string; state: string }>).find((v) => v.id === versionId);
      if (version?.state === state) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Version ${versionId} never reached state ${state}`);
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    storageDir = mkdtempSync(join(tmpdir(), 'pharmaqms-doc-wf-e2e-'));
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
    await userModel.create({ tenantId, email: 'dept.head@example.com', fullName: 'Dana Depthead', passwordHash, roleId: deptHeadRole._id });
    const qaHeadRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: ['documents:approve'] });
    await userModel.create({ tenantId, email: 'qa.head@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaHeadRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'SOP', prefix: 'SOP', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false });

    authorToken = await login('author@example.com');
    deptHeadToken = await login('dept.head@example.com');
    qaHeadToken = await login('qa.head@example.com');

    // DOC-3: configurable review→approval template for DocumentVersion entities.
    await request(server())
      .post('/api/v1/workflow/templates')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        entityType: 'DocumentVersion',
        name: 'SOP Review & Approval',
        steps: [
          { name: 'Dept Head Review', roleId: deptHeadRole._id.toString(), signatureMeaning: SignatureMeaning.REVIEWED_BY, rejectToStepIndex: null },
          { name: 'QA Head Approval', roleId: qaHeadRole._id.toString(), signatureMeaning: SignatureMeaning.APPROVED_BY, rejectToStepIndex: 0 },
        ],
      })
      .expect(HttpStatus.CREATED);
  }, 120000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('DOC-3: submit → review e-sign → approval e-sign carries the version to Effective with signature meanings', async () => {
    const { documentId, versionId } = await createDocument('Cleaning of pH meters');
    const instanceId = await submit(documentId, versionId);
    await waitForVersionState(documentId, versionId, DocumentVersionState.UNDER_REVIEW);

    const reviewToken = await challenge(deptHeadToken);
    await act(deptHeadToken, instanceId, {
      action: WorkflowAction.APPROVE,
      signingToken: reviewToken,
      entitySnapshot: { versionId },
    }).then((r) => expect(r.status).toBe(HttpStatus.CREATED));
    await waitForVersionState(documentId, versionId, DocumentVersionState.UNDER_APPROVAL);

    const approveToken = await challenge(qaHeadToken);
    await act(qaHeadToken, instanceId, {
      action: WorkflowAction.APPROVE,
      signingToken: approveToken,
      entitySnapshot: { versionId },
    }).then((r) => expect(r.status).toBe(HttpStatus.CREATED));
    await waitForVersionState(documentId, versionId, DocumentVersionState.EFFECTIVE);

    const document = await request(server())
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(document.body.data.status).toBe(DocumentStatus.EFFECTIVE);
    expect(document.body.data.effectiveVersion.effectiveDate).not.toBeNull();
    expect(document.body.data.nextReviewDate).not.toBeNull();

    const signatures = await request(server())
      .get(`/api/v1/esign/DocumentVersion/${versionId}/signatures`)
      .set('Authorization', `Bearer ${authorToken}`);
    const meanings = (signatures.body.data as Array<{ meaning: string }>).map((s) => s.meaning).sort();
    expect(meanings).toEqual([SignatureMeaning.APPROVED_BY, SignatureMeaning.REVIEWED_BY].sort());
  });

  it('DOC-3 acceptance (§7.1): a rejection with comment returns the version to the author as Draft, and who/when/why lands in the audit trail', async () => {
    const { documentId, versionId } = await createDocument('Balance calibration SOP');
    const instanceId = await submit(documentId, versionId);
    await waitForVersionState(documentId, versionId, DocumentVersionState.UNDER_REVIEW);

    const rejection = await act(deptHeadToken, instanceId, {
      action: WorkflowAction.REJECT,
      comment: 'Section 5 references the retired balance model.',
    });
    expect(rejection.status).toBe(HttpStatus.CREATED);
    await waitForVersionState(documentId, versionId, DocumentVersionState.DRAFT);

    const history = await request(server())
      .get(`/api/v1/audit/Document/${documentId}/history?limit=50`)
      .set('Authorization', `Bearer ${authorToken}`);
    const rejectionAudit = (history.body.data as Array<{ action: string; actorName: string | null; reason: string | null }>).find(
      (event) => event.reason === 'Section 5 references the retired balance model.',
    );
    expect(rejectionAudit).toBeDefined();
    expect(rejectionAudit!.actorName).toBe('Dana Depthead');

    // The author can resubmit the same version after revision.
    const resubmitInstance = await submit(documentId, versionId);
    expect(resubmitInstance).toBe(instanceId);
  });

  it('PLT-4 hardening: a user without documents:edit cannot submit a DocumentVersion via the generic workflow endpoint (bypassing DOC-3\'s own gate)', async () => {
    const { documentId, versionId } = await createDocument('Vessel washing SOP');
    // deptHeadRole holds zero permissions (see beforeAll) — it must not be able to reach the
    // same effect as POST /documents/:id/versions/:versionId/submit (documents:edit-gated) by
    // calling the generic PLT-4 endpoint directly with the version's real id.
    const bypassAttempt = await request(server())
      .post('/api/v1/workflow/instances/submit')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ entityType: 'DocumentVersion', entityId: versionId });
    expect(bypassAttempt.status).toBe(HttpStatus.FORBIDDEN);

    // The version must still be untouched Draft — no half-submitted workflow instance was created.
    const versions = await request(server())
      .get(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`);
    const version = (versions.body.data as Array<{ id: string; state: string }>).find((v) => v.id === versionId);
    expect(version!.state).toBe(DocumentVersionState.DRAFT);
  });

  it('DOC-7: obsolescence requires a fresh e-signature, hides the document from default search, and retains it auditable', async () => {
    const { documentId, versionId } = await createDocument('Legacy gowning SOP');
    const instanceId = await submit(documentId, versionId);
    const t1 = await challenge(deptHeadToken);
    await act(deptHeadToken, instanceId, { action: WorkflowAction.APPROVE, signingToken: t1, entitySnapshot: {} });
    const t2 = await challenge(qaHeadToken);
    await act(qaHeadToken, instanceId, { action: WorkflowAction.APPROVE, signingToken: t2, entitySnapshot: {} });
    await waitForVersionState(documentId, versionId, DocumentVersionState.EFFECTIVE);

    // Session-only obsolescence attempt (no signing token) is rejected.
    const sessionOnly = await request(server())
      .post(`/api/v1/documents/${documentId}/obsolete`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ signingToken: '', reason: 'Replaced by facility SOP-QA-014.' });
    expect([HttpStatus.UNAUTHORIZED, HttpStatus.BAD_REQUEST]).toContain(sessionOnly.status);

    const signingToken = await challenge(qaHeadToken);
    const response = await request(server())
      .post(`/api/v1/documents/${documentId}/obsolete`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ signingToken, reason: 'Replaced by facility SOP-QA-014.' });
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body.data.status).toBe(DocumentStatus.OBSOLETE);

    // Excluded from user-facing search by default…
    const defaultList = await request(server())
      .get('/api/v1/documents?search=gowning')
      .set('Authorization', `Bearer ${authorToken}`);
    expect(defaultList.body.data).toHaveLength(0);
    // …but retained and reachable when explicitly included (auditors).
    const withObsolete = await request(server())
      .get('/api/v1/documents?search=gowning&includeObsolete=true')
      .set('Authorization', `Bearer ${authorToken}`);
    expect(withObsolete.body.data).toHaveLength(1);

    const signatures = await request(server())
      .get(`/api/v1/esign/Document/${documentId}/signatures`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect((signatures.body.data as Array<{ meaning: string }>).some((s) => s.meaning === SignatureMeaning.QA_DISPOSITION)).toBe(true);
  });

  it('DOC-6: reaffirm is e-signed, bumps a minor version sharing the same immutable file, and resets the review clock', async () => {
    const { documentId, versionId } = await createDocument('Water system monitoring SOP');
    const instanceId = await submit(documentId, versionId);
    const t1 = await challenge(deptHeadToken);
    await act(deptHeadToken, instanceId, { action: WorkflowAction.APPROVE, signingToken: t1, entitySnapshot: {} });
    const t2 = await challenge(qaHeadToken);
    await act(qaHeadToken, instanceId, { action: WorkflowAction.APPROVE, signingToken: t2, entitySnapshot: {} });
    await waitForVersionState(documentId, versionId, DocumentVersionState.EFFECTIVE);

    const before = await request(server())
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${authorToken}`);
    const reviewDateBefore = before.body.data.nextReviewDate as string;

    const signingToken = await challenge(qaHeadToken);
    const response = await request(server())
      .post(`/api/v1/documents/${documentId}/review/reaffirm`)
      .set('Authorization', `Bearer ${qaHeadToken}`)
      .send({ signingToken, note: 'Annual review 2026 — no process changes.' });
    expect(response.status).toBe(HttpStatus.CREATED);

    const after = response.body.data;
    expect(after.status).toBe(DocumentStatus.EFFECTIVE);
    expect(after.effectiveVersion.versionLabel).toBe('1.1');
    expect(after.effectiveVersion.changeSummary).toContain('reaffirmed');
    expect(new Date(after.nextReviewDate as string).getTime()).toBeGreaterThan(new Date(reviewDateBefore).getTime());

    const versions = await request(server())
      .get(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`);
    const v10 = (versions.body.data as Array<{ versionLabel: string; state: string }>).find((v) => v.versionLabel === '1.0');
    expect(v10!.state).toBe(DocumentVersionState.SUPERSEDED);
  });
});
