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

describe('EQP-11 Calibration Agency HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let departmentId: string;
  let engineerToken: string;
  let operatorToken: string;
  let agencyId: string;
  let equipmentId: string;

  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId, email, password: 'Correct1!' });
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
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const engineerRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'engineer@example.com', fullName: 'Eddie Engineer', passwordHash, roleId: engineerRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    engineerToken = await login('engineer@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('EQP-11: creates a calibration agency (audited)', async () => {
    const response = await request(server())
      .post('/api/v1/equipment/calibration-agencies')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ name: 'Cal-Labs Inc', accreditationNumber: 'NABL-12345', accreditationValidUntil: '2099-01-01' });

    expect(response.status).toBe(HttpStatus.CREATED);
    agencyId = response.body.data.id;
    expect(response.body.data.status).toBe('active');
  });

  it('PLT-1: an operator without equipment:edit cannot create an agency', async () => {
    const response = await request(server()).post('/api/v1/equipment/calibration-agencies').set('Authorization', `Bearer ${operatorToken}`).send({ name: 'X' });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('EQP-11: uploads and downloads an accreditation certificate', async () => {
    const upload = await request(server())
      .post(`/api/v1/equipment/calibration-agencies/${agencyId}/certificates`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'nabl-cert.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(HttpStatus.CREATED);
    expect(upload.body.data.certificates).toHaveLength(1);
    const certificateId = upload.body.data.certificates[0].id;

    const download = await request(server())
      .get(`/api/v1/equipment/calibration-agencies/${agencyId}/certificates/${certificateId}`)
      .set('Authorization', `Bearer ${engineerToken}`);
    expect(download.status).toBe(HttpStatus.OK);
    expect(download.headers['content-type']).toBe('application/pdf');
  });

  it('EQP-11: links a calibration schedule to the agency, and the agency-wise due list + certificate registry reflect it', async () => {
    const equipmentResponse = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ name: 'pH Meter', location: 'QC Lab', departmentId, isGmpCritical: true });
    equipmentId = equipmentResponse.body.data.id;

    const scheduleResponse = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-schedule`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ frequencyMonths: 12, parameters: 'pH buffers', toleranceClass: 'Class A', agencyType: 'external', agencyId, nextDueDate: '2020-01-01' });
    expect(scheduleResponse.status).toBe(HttpStatus.CREATED);
    expect(scheduleResponse.body.data.agencyId).toBe(agencyId);

    const due = await request(server()).get('/api/v1/equipment/calibration-agencies/due').set('Authorization', `Bearer ${engineerToken}`);
    expect(due.status).toBe(HttpStatus.OK);
    expect(due.body.data.some((entry: { agencyId: string }) => entry.agencyId === agencyId)).toBe(true);

    const csv = await request(server()).get('/api/v1/equipment/calibration-agencies/due.csv').set('Authorization', `Bearer ${engineerToken}`);
    expect(csv.status).toBe(HttpStatus.OK);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.text).toContain('Cal-Labs Inc');

    const pdf = await request(server())
      .get('/api/v1/equipment/calibration-agencies/due.pdf')
      .set('Authorization', `Bearer ${engineerToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(HttpStatus.OK);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const record = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2026-01-01')
      .field('result', 'pass')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'calibration-cert.pdf', contentType: 'application/pdf' });
    expect(record.status).toBe(HttpStatus.CREATED);

    const registry = await request(server()).get('/api/v1/equipment/calibration-agencies/certificates').set('Authorization', `Bearer ${engineerToken}`);
    expect(registry.status).toBe(HttpStatus.OK);
    expect(registry.body.data).toHaveLength(1);
    expect(registry.body.data[0].agencyId).toBe(agencyId);

    const certificateDownload = await request(server())
      .get(`/api/v1/equipment/${equipmentId}/calibration-records/${record.body.data.id}/certificate`)
      .set('Authorization', `Bearer ${engineerToken}`);
    expect(certificateDownload.status).toBe(HttpStatus.OK);
    expect(certificateDownload.headers['content-type']).toBe('application/pdf');
  });

  it('EQP-11: a status transition follows the map and is reversible', async () => {
    const suspended = await request(server()).post(`/api/v1/equipment/calibration-agencies/${agencyId}/status`).set('Authorization', `Bearer ${engineerToken}`).send({ status: 'suspended' });
    expect(suspended.status).toBe(HttpStatus.CREATED);
    expect(suspended.body.data.status).toBe('suspended');

    const reactivated = await request(server()).post(`/api/v1/equipment/calibration-agencies/${agencyId}/status`).set('Authorization', `Bearer ${engineerToken}`).send({ status: 'active' });
    expect(reactivated.status).toBe(HttpStatus.CREATED);
    expect(reactivated.body.data.status).toBe('active');
  });

  it('PLT-8 tenant isolation: another tenant cannot see this agency', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: 'Correct1!' });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const getAttempt = await request(server()).get(`/api/v1/equipment/calibration-agencies/${agencyId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(getAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
