import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS } from '@pharmaqms/shared';
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

describe('DOC-1 DOC-2 DOC-8 Documents HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let storageDir: string;
  let tenantId: string;
  let departmentId: string;
  let authorToken: string;
  let operatorToken: string;
  let documentId: string;
  let versionId: string;

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email, password: 'Correct1!' });
    return response.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    storageDir = mkdtempSync(join(tmpdir(), 'pharmaqms-doc-e2e-'));
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
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const authorRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'author@example.com', fullName: 'QA Executive', passwordHash, roleId: authorRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Operator', passwordHash, roleId: operatorRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'SOP', prefix: 'SOP', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false });

    authorToken = await login('author@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('DOC-1: creates a document via multipart upload — numbered, audited, version 1.0 draft', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${authorToken}`)
      .field('title', 'Cleaning of pH meters')
      .field('docType', 'sop')
      .field('departmentId', departmentId)
      .field('reviewFrequencyMonths', '12')
      .attach('file', Buffer.from('%PDF-1.7 e2e test file'), { filename: 'sop.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(HttpStatus.CREATED);
    documentId = response.body.data.id;
    versionId = response.body.data.latestVersion.id;
    expect(response.body.data.docNumber).toBe('SOP-QA-001');
    expect(response.body.data.latestVersion.versionLabel).toBe('1.0');

    const history = await request(app.getHttpServer())
      .get(`/api/v1/audit/Document/${documentId}/history`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect((history.body.data as Array<{ action: string }>).some((e) => e.action === 'create')).toBe(true);
  });

  it('DOC-1: the uploaded file streams back intact', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/documents/${documentId}/versions/${versionId}/file`)
      .set('Authorization', `Bearer ${authorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect((response.body as Buffer).toString()).toBe('%PDF-1.7 e2e test file');
  });

  it('PLT-1: a user without documents:create cannot create documents', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${operatorToken}`)
      .field('title', 'Nope')
      .field('docType', 'sop')
      .field('departmentId', departmentId)
      .field('reviewFrequencyMonths', '12')
      .attach('file', Buffer.from('%PDF-'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('DOC-8: creating a new version without a change summary is rejected at the edge', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${authorToken}`)
      .field('bump', 'major')
      .attach('file', Buffer.from('%PDF-1.7 v2'), { filename: 'sop-v2.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DOC-1: documents list is tenant-scoped and paginated', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/documents?page=1&limit=10')
      .set('Authorization', `Bearer ${authorToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].docNumber).toBe('SOP-QA-001');
  });

  it('Iron Rule 5: an outsider tenant cannot read, list, download, or submit this document/version', async () => {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderTenantId = new mongoose.Types.ObjectId().toString();
    const outsiderRole = await roleModel.create({ tenantId: outsiderTenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({ tenantId: outsiderTenantId, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: outsiderTenantId, email: 'outsider@else.example', password: 'Correct1!' });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const get = await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(get.status).toBe(HttpStatus.NOT_FOUND);

    const list = await request(app.getHttpServer()).get('/api/v1/documents').set('Authorization', `Bearer ${outsiderToken}`);
    expect(list.status).toBe(HttpStatus.OK);
    expect(list.body.meta.total).toBe(0);

    const file = await request(app.getHttpServer())
      .get(`/api/v1/documents/${documentId}/versions/${versionId}/file`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(file.status).toBe(HttpStatus.NOT_FOUND);

    // Write attempt — even with ALL_PERMISSION_KEYS, tenant scoping must reject before any
    // permission check has a chance to matter (Iron Rule 5: never derive tenantId from params).
    const submitAttempt = await request(app.getHttpServer())
      .post(`/api/v1/documents/${documentId}/versions/${versionId}/submit`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(submitAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
