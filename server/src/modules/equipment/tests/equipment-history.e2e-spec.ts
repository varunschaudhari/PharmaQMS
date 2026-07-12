import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';

const PASSWORD = 'Correct1!';

// EQP-10: full-lifecycle equipment history PDF — HTTP surface smoke test (mirrors TRN-4's
// employeeRecordPdf e2e test: assert 200 + PDF content-type + %PDF- magic bytes; the aggregation
// content itself is unit-tested directly against EquipmentHistoryReportService.buildReport()).
describe('EQP-10 Equipment History Report HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let departmentId: string;
  let engineerToken: string;
  let noPermissionToken: string;
  let equipmentId: string;

  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId, email, password: PASSWORD });
    return response.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

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

    const engineerRole = await roleModel.create({ tenantId, name: 'Maintenance Engineer', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'engineer@qplive.example', fullName: 'Eddie Engineer', passwordHash, roleId: engineerRole._id });

    const noPermissionRole = await roleModel.create({ tenantId, name: 'No Permissions', permissions: [] });
    await userModel.create({ tenantId, email: 'nobody@qplive.example', fullName: 'No Body', passwordHash, roleId: noPermissionRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    engineerToken = await login('engineer@qplive.example');
    noPermissionToken = await login('nobody@qplive.example');

    const created = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ name: 'Autoclave', location: 'Sterile Suite', departmentId, isGmpCritical: true });
    equipmentId = created.body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('EQP-10: downloads a real PDF for an equipment with no history yet', async () => {
    const response = await request(server())
      .get(`/api/v1/equipment/${equipmentId}/history-report.pdf`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toBe('application/pdf');
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('PLT-1: equipment:view is required to download the history report', async () => {
    const response = await request(server())
      .get(`/api/v1/equipment/${equipmentId}/history-report.pdf`)
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-8 tenant isolation: another tenant cannot download this equipment history report', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const attempt = await request(server()).get(`/api/v1/equipment/${equipmentId}/history-report.pdf`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(attempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
