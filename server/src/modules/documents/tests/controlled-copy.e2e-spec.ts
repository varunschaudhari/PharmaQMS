import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, AuditAction, DocumentVersionState, SignatureMeaning, WorkflowAction } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { AuditEvent, AuditEventDocument } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';

// Builds a real 2-page PDF so the stamper has authentic input.
async function buildSourcePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

describe('DOC-4 DOC-5 controlled copies + QR version check', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let storageDir: string;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let departmentId: string;
  let authorToken: string;
  let deptHeadToken: string;
  let qaHeadToken: string;
  let documentId: string;
  let v1Id: string;
  let v1QrCode: string;

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

  async function approveToEffective(versionId: string): Promise<void> {
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
      const versions = await request(server())
        .get(`/api/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${authorToken}`);
      const version = (versions.body.data as Array<{ id: string; state: string }>).find((v) => v.id === versionId);
      if (version?.state === DocumentVersionState.EFFECTIVE) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('version never became effective');
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    storageDir = mkdtempSync(join(tmpdir(), 'pharmaqms-cc-e2e-'));
    process.env.FILE_STORAGE_DIR = storageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    auditEventModel = moduleFixture.get<Model<AuditEventDocument>>(getModelToken(AuditEvent.name));
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
    const qaHeadRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: [] });
    await userModel.create({ tenantId, email: 'qa.head@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaHeadRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'SOP', prefix: 'SOP', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false });

    authorToken = await login('author@example.com');
    deptHeadToken = await login('dept.head@example.com');
    qaHeadToken = await login('qa.head@example.com');

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
      });

    // Create the document (v1.0) and make it effective.
    const created = await request(server())
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${authorToken}`)
      .field('title', 'Gowning procedure')
      .field('docType', 'sop')
      .field('departmentId', departmentId)
      .field('reviewFrequencyMonths', '12')
      .attach('file', await buildSourcePdf(), { filename: 'gowning.pdf', contentType: 'application/pdf' });
    documentId = created.body.data.id;
    v1Id = created.body.data.latestVersion.id;
    await request(server())
      .post(`/api/v1/documents/${documentId}/versions/${v1Id}/submit`)
      .set('Authorization', `Bearer ${authorToken}`);
    await approveToEffective(v1Id);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('DOC-4: the controlled copy is a stamped PDF (same page count) and printing it is audited (who/version/when)', async () => {
    const response = await request(server())
      .get(`/api/v1/documents/${documentId}/versions/${v1Id}/controlled-copy.pdf`)
      .set('Authorization', `Bearer ${authorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toBe('application/pdf');
    const stamped = await PDFDocument.load(response.body as Buffer);
    expect(stamped.getPageCount()).toBe(2);

    const printAudits = await auditEventModel.find({
      tenantId,
      entityType: 'Document',
      entityId: documentId,
      action: AuditAction.CONTROLLED_COPY_PRINTED,
    });
    expect(printAudits).toHaveLength(1);
    expect(printAudits[0].actorName).toBe('QA Executive');
  });

  it('DOC-5: scanning the CURRENT version needs no login and shows version + effective date', async () => {
    // The controlled-copy generation minted the version QR — fetch it through the tenant API.
    const resolveQr = await request(server())
      .get(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`);
    void resolveQr;
    // Find the code by asking the QR service through its own surface: create is idempotent.
    const qr = await request(server())
      .post('/api/v1/qr/codes')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ entityType: 'DocumentVersion', entityId: v1Id, entityCode: 'ignored', entityName: 'ignored' });
    v1QrCode = qr.body.data.code;

    // NO Authorization header — the whole point of DOC-5.
    const response = await request(server()).get(`/api/v1/public/doc-check/${v1QrCode}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data).toMatchObject({
      status: 'current',
      docNumber: 'SOP-QA-001',
      scannedVersion: '1.0',
      currentVersion: null,
    });
    expect(response.body.data.scannedEffectiveDate).not.toBeNull();
  });

  it('DOC-5 acceptance (§7.1): once v2.0 becomes Effective, scanning the printed v1.0 copy shows OBSOLETE with the current version number', async () => {
    const v2 = await request(server())
      .post(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`)
      .field('bump', 'major')
      .field('changeSummary', 'New gowning sequence for Grade B areas.')
      .attach('file', await buildSourcePdf(), { filename: 'gowning-v2.pdf', contentType: 'application/pdf' });
    const v2Id = v2.body.data.id as string;
    await request(server())
      .post(`/api/v1/documents/${documentId}/versions/${v2Id}/submit`)
      .set('Authorization', `Bearer ${authorToken}`);
    await approveToEffective(v2Id);

    const staleScan = await request(server()).get(`/api/v1/public/doc-check/${v1QrCode}`);
    expect(staleScan.status).toBe(HttpStatus.OK);
    expect(staleScan.body.data).toMatchObject({
      status: 'obsolete',
      scannedVersion: '1.0',
      currentVersion: '2.0',
    });

    // And v2.0's own controlled copy scans as CURRENT.
    await request(server())
      .get(`/api/v1/documents/${documentId}/versions/${v2Id}/controlled-copy.pdf`)
      .set('Authorization', `Bearer ${authorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    const v2Qr = await request(server())
      .post('/api/v1/qr/codes')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ entityType: 'DocumentVersion', entityId: v2Id, entityCode: 'ignored', entityName: 'ignored' });
    const currentScan = await request(server()).get(`/api/v1/public/doc-check/${v2Qr.body.data.code}`);
    expect(currentScan.body.data.status).toBe('current');
  });

  it('DOC-5: an unknown or non-document code stays a plain 404 — nothing leaks publicly', async () => {
    const response = await request(server()).get('/api/v1/public/doc-check/NOSUCHCODE');
    expect(response.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('DOC-4: a draft version has no controlled copy', async () => {
    const draft = await request(server())
      .post(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`)
      .field('bump', 'minor')
      .field('changeSummary', 'Typo fixes.')
      .attach('file', await buildSourcePdf(), { filename: 'gowning-v21.pdf', contentType: 'application/pdf' });

    const response = await request(server())
      .get(`/api/v1/documents/${documentId}/versions/${draft.body.data.id}/controlled-copy.pdf`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
  });
});
