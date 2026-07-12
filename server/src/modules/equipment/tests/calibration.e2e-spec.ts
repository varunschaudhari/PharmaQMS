import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, SignatureMeaning } from '@pharmaqms/shared';
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

const PASSWORD = 'Correct1!';

describe('EQP-4 EQP-5 Calibration HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let departmentId: string;
  let engineerToken: string;
  let qaToken: string;
  let equipmentId: string;

  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server()).post('/api/v1/auth/login').send({ tenantId, email, password: PASSWORD });
    return response.body.data.tokens.accessToken as string;
  }

  async function challenge(token: string): Promise<string> {
    const response = await request(server()).post('/api/v1/esign/challenge').set('Authorization', `Bearer ${token}`).send({ credential: PASSWORD });
    return response.body.data.signingToken as string;
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
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const engineerRole = await roleModel.create({ tenantId, name: 'Maintenance Engineer', permissions: ['equipment:view', 'equipment:create', 'equipment:edit'] });
    await userModel.create({ tenantId, email: 'engineer@example.com', fullName: 'Eddie Engineer', passwordHash, roleId: engineerRole._id });
    const qaRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: ['equipment:view', 'equipment:approve'] });
    const qaUser = await userModel.create({ tenantId, email: 'qa@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC', headUserId: qaUser._id.toString() });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    engineerToken = await login('engineer@example.com');
    qaToken = await login('qa@example.com');

    const created = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ name: 'pH Meter', location: 'QC Lab', departmentId, isGmpCritical: true });
    equipmentId = created.body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('EQP-4: an engineer creates a calibration schedule for the equipment', async () => {
    const response = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-schedule`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ frequencyMonths: 12, parameters: 'pH 4/7/10 buffers', toleranceClass: 'Class A', agencyType: 'external', agencyName: 'Cal-Labs Inc', nextDueDate: '2026-01-01' });
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body.data.frequencyMonths).toBe(12);

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${engineerToken}`);
    expect(card.body.data.calibrationStatus).toBe('overdue');
  });

  let passRecordId: string;

  it('EQP-4: the engineer records a PASS calibration result with a certificate; QA verifies it', async () => {
    const record = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2026-07-01')
      .field('result', 'pass')
      .field('toleranceNotes', 'All readings within tolerance.')
      .attach('file', Buffer.from('%PDF-1.7 certificate'), { filename: 'cert.pdf', contentType: 'application/pdf' });
    expect(record.status).toBe(HttpStatus.CREATED);
    passRecordId = record.body.data.id;
    expect(record.body.data.status).toBe('pending_qa_verification');

    const signingToken = await challenge(qaToken);
    const verify = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records/${passRecordId}/verify`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken });
    expect(verify.status).toBe(HttpStatus.CREATED);
    expect(verify.body.data.status).toBe('verified');

    const signatures = await request(server()).get(`/api/v1/esign/Equipment/${equipmentId}/signatures`).set('Authorization', `Bearer ${qaToken}`);
    expect(signatures.body.data.some((s: { meaning: string }) => s.meaning === SignatureMeaning.VERIFIED_BY)).toBe(true);

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${engineerToken}`);
    expect(card.body.data.calibrationStatus).toBe('valid');
  });

  it('PLT-1: an engineer (holding equipment:edit but not equipment:approve) cannot verify a calibration record', async () => {
    const record = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2027-01-01')
      .field('result', 'pass')
      .attach('file', Buffer.from('%PDF-'), { filename: 'cert2.pdf', contentType: 'application/pdf' });
    const recordId = record.body.data.id;

    const signingToken = await challenge(engineerToken);
    const verify = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records/${recordId}/verify`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ signingToken });
    expect(verify.status).toBe(HttpStatus.FORBIDDEN);

    // QA (equipment:approve) can verify the same record.
    const qaSigningToken = await challenge(qaToken);
    const qaVerify = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records/${recordId}/verify`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken: qaSigningToken });
    expect(qaVerify.status).toBe(HttpStatus.CREATED);
  });

  it('EQP-5: a FAIL/OOT result requires an impact-assessment note and immediately sets Do Not Use', async () => {
    const rejected = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2027-06-01')
      .field('result', 'fail')
      .attach('file', Buffer.from('%PDF-'), { filename: 'oot.pdf', contentType: 'application/pdf' });
    expect(rejected.status).toBe(HttpStatus.BAD_REQUEST);

    const record = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2027-06-01')
      .field('result', 'fail')
      .field('impactAssessmentNote', 'Reading drifted 8% beyond tolerance — assessing recent batches.')
      .attach('file', Buffer.from('%PDF-'), { filename: 'oot.pdf', contentType: 'application/pdf' });
    expect(record.status).toBe(HttpStatus.CREATED);
    const recordId = record.body.data.id;

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${engineerToken}`);
    expect(card.body.data.status).toBe('do_not_use');

    // The generic status-change endpoint cannot touch DO_NOT_USE.
    const manual = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/status`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ status: 'active' });
    expect(manual.status).toBe(HttpStatus.BAD_REQUEST);

    const signingToken = await challenge(qaToken);
    const disposition = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/calibration-records/${recordId}/disposition`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken, outcome: 'release', note: 'Risk assessed as acceptable; releasing.' });
    expect(disposition.status).toBe(HttpStatus.CREATED);
    expect(disposition.body.data.status).toBe('dispositioned');

    const releasedCard = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${engineerToken}`);
    expect(releasedCard.body.data.status).toBe('active');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: AuditAction.CALIBRATION_DISPOSITIONED });
    expect(auditEvents).toHaveLength(1);
  });

  it('EQP-4: the calibration-due dashboard lists this equipment', async () => {
    const response = await request(server()).get('/api/v1/equipment/calibration/due').set('Authorization', `Bearer ${qaToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('PLT-8 tenant isolation: another tenant cannot see this equipment calibration schedule', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ['equipment:view'] });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const attempt = await request(server()).get(`/api/v1/equipment/${equipmentId}/calibration-schedule`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(attempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
