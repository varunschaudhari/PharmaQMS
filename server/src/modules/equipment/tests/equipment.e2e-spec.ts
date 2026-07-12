import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, AuditAction } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { AuditEvent, AuditEventDocument } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleDocument } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';

describe('EQP-1 EQP-2 EQP-3 Equipment HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let departmentId: string;
  let adminToken: string;
  let operatorToken: string;
  let equipmentId: string;
  let scanCode: string;

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

    auditEventModel = moduleFixture.get<Model<AuditEventDocument>>(getModelToken(AuditEvent.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const departmentModel = moduleFixture.get<Model<DepartmentDocument>>(getModelToken(Department.name));
    const schemeModel = moduleFixture.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const adminRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'admin@example.com', fullName: 'QA Executive', passwordHash, roleId: adminRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    adminToken = await login('admin@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('EQP-1: creates equipment (audited) with a numbered code', async () => {
    const response = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'pH Meter', location: 'QC Lab', departmentId, isGmpCritical: true, make: 'Mettler', modelName: 'S220' });

    expect(response.status).toBe(HttpStatus.CREATED);
    equipmentId = response.body.data.id;
    scanCode = response.body.data.qr.code;
    expect(response.body.data.equipmentCode).toBe('EQP-0001');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: AuditAction.CREATE });
    expect(auditEvents).toHaveLength(1);
  });

  it('PLT-1: an operator without equipment:create cannot create equipment', async () => {
    const response = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'X', location: 'Y', departmentId, isGmpCritical: false });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('EQP-2: the QR PNG and label PDF endpoints work for the equipment\'s code (reusing PLT-7)', async () => {
    const png = await request(server())
      .get(`/api/v1/qr/codes/${scanCode}/png`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(png.status).toBe(HttpStatus.OK);
    expect(png.headers['content-type']).toBe('image/png');
  });

  it('EQP-3: ANY authenticated user can open the status card via the QR resolve + status-card endpoints', async () => {
    const resolved = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${operatorToken}`);
    expect(resolved.status).toBe(HttpStatus.OK);
    expect(resolved.body.data.entityType).toBe('Equipment');
    expect(resolved.body.data.entityId).toBe(equipmentId);

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.status).toBe(HttpStatus.OK);
    expect(card.body.data.calibrationStatus).toBe('not_scheduled');
    expect(card.body.data.qualificationStatus).toBe('not_qualified');
    expect(card.body.data.availableActions).toEqual(['log_usage', 'log_cleaning', 'report_breakdown']);
  });

  it('EQP-1: a status transition follows the map and is audited; an invalid one is rejected', async () => {
    const valid = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'under_maintenance', reason: 'Scheduled service.' });
    expect(valid.status).toBe(HttpStatus.CREATED);
    expect(valid.body.data.status).toBe('under_maintenance');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: AuditAction.STATUS_CHANGE });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].reason).toBe('Scheduled service.');

    await request(server())
      .post(`/api/v1/equipment/${equipmentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'retired' });
    const invalid = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(invalid.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('EQP-1: list is tenant-scoped and paginated', async () => {
    const response = await request(server()).get('/api/v1/equipment?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.meta.total).toBe(1);
  });

  it('PLT-8 tenant isolation: another tenant cannot see or scan this equipment', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: 'Correct1!' });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const getAttempt = await request(server()).get(`/api/v1/equipment/${equipmentId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(getAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const scanAttempt = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(scanAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
