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
import { Tenant, TenantDocument } from '../../../platform/tenant/schemas/tenant.schema';

const PASSWORD = 'Correct1!';

describe('EQP-6 EQP-7 Logbook + Maintenance HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let departmentId: string;
  let operatorToken: string;
  let engineerToken: string;
  let qaToken: string;
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
    const tenantModel = moduleFixture.get<Model<TenantDocument>>(getModelToken(Tenant.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    // A real Tenant document is required here (unlike other EQP e2e fixtures) because this test
    // needs a non-default setting (maintenanceRoleId) — resolveMaintenanceRoleId() falls back to
    // null when no Tenant document exists at all, which would silently defeat this test.
    await tenantModel.create({ _id: tenantId, name: 'Lgb Pharma Live', slug: `lgb-pharma-live-${tenantId}` });

    const adminRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'admin@lgblive.example', fullName: 'QA Executive', passwordHash, roleId: adminRole._id });

    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@lgblive.example', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    const engineerRole = await roleModel.create({ tenantId, name: 'Maintenance Engineer', permissions: ['equipment:view', 'equipment:create', 'equipment:edit'] });
    await userModel.create({ tenantId, email: 'engineer@lgblive.example', fullName: 'Eddie Engineer', passwordHash, roleId: engineerRole._id });

    const qaRole = await roleModel.create({ tenantId, name: 'QA Head', permissions: ['equipment:view', 'equipment:approve'] });
    await userModel.create({ tenantId, email: 'qa@lgblive.example', fullName: 'Quinn Qahead', passwordHash, roleId: qaRole._id });

    const maintenanceRole = await roleModel.create({ tenantId, name: 'Maintenance Team', permissions: ['equipment:view'] });
    await userModel.create({ tenantId, email: 'maintainer@lgblive.example', fullName: 'Mo Maintainer', passwordHash, roleId: maintenanceRole._id });
    await tenantModel.updateOne({ _id: tenantId }, { $set: { 'settings.maintenanceRoleId': maintenanceRole._id.toString() } });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    operatorToken = await login('operator@lgblive.example');
    engineerToken = await login('engineer@lgblive.example');
    qaToken = await login('qa@lgblive.example');

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

  let usageStartEntryId: string;

  it('EQP-6: an authenticated operator (no elevated permission) starts and stops a usage session', async () => {
    const start = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/usage-start`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productBatchRef: 'BATCH-100' });
    expect(start.status).toBe(HttpStatus.CREATED);
    expect(start.body.data.entryType).toBe('usage_start');
    usageStartEntryId = start.body.data.id;

    const doubleStart = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/usage-start`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productBatchRef: 'BATCH-101' });
    expect(doubleStart.status).toBe(HttpStatus.BAD_REQUEST);

    const stop = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/usage-stop`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({});
    expect(stop.status).toBe(HttpStatus.CREATED);
    expect(stop.body.data.entryType).toBe('usage_stop');
  });

  it('EQP-6: logs a cleaning entry', async () => {
    const response = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/cleaning`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ cleaningType: 'full' });
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body.data.cleaningType).toBe('full');
  });

  let breakdownEntryId: string;
  let maintenanceTaskId: string;

  it('EQP-6/EQP-7: a breakdown report (with a photo) auto-creates a maintenance task and notifies the maintenance role', async () => {
    const response = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/breakdown`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .field('description', 'Door seal failed during cycle.')
      .attach('photo', Buffer.from('fake-jpeg-bytes'), { filename: 'breakdown.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(HttpStatus.CREATED);
    breakdownEntryId = response.body.data.entry.id;
    maintenanceTaskId = response.body.data.maintenanceTask.id;
    expect(response.body.data.maintenanceTask.status).toBe('open');

    const photo = await request(server())
      .get(`/api/v1/equipment/${equipmentId}/logbook/${breakdownEntryId}/photo`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(photo.status).toBe(HttpStatus.OK);
    expect(photo.headers['content-type']).toBe('image/jpeg');

    const maintainerLogin = await login('maintainer@lgblive.example');
    const notifications = await request(server()).get('/api/v1/notifications?limit=20').set('Authorization', `Bearer ${maintainerLogin}`);
    expect(notifications.body.data.some((n: { event: string }) => n.event === 'task_assigned')).toBe(true);
  });

  it('EQP-6: the status card shows the last 5 logbook entries', async () => {
    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.status).toBe(HttpStatus.OK);
    expect(card.body.data.recentLogbookEntries.length).toBeGreaterThan(0);
    expect(card.body.data.recentLogbookEntries[0].entryType).toBe('breakdown');
  });

  it('EQP-6: a correction is logged as a NEW amendment entry, never an edit', async () => {
    const amend = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/logbook/${usageStartEntryId}/amend`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ amendsEntryId: usageStartEntryId, description: 'Wrong batch ref recorded — correcting to BATCH-100R.' });
    expect(amend.status).toBe(HttpStatus.CREATED);
    expect(amend.body.data.entryType).toBe('amendment');
    expect(amend.body.data.amendsEntryId).toBe(usageStartEntryId);

    const list = await request(server()).get(`/api/v1/equipment/${equipmentId}/logbook`).set('Authorization', `Bearer ${operatorToken}`);
    const original = list.body.data.find((e: { id: string }) => e.id === usageStartEntryId);
    expect(original.productBatchRef).toBe('BATCH-100'); // unchanged
  });

  it('PLT-1: an operator (no equipment:edit) cannot close a maintenance task; the engineer can', async () => {
    const denied = await request(server())
      .post(`/api/v1/equipment/maintenance-tasks/${maintenanceTaskId}/close`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ completionNote: 'Attempted fix.' });
    expect(denied.status).toBe(HttpStatus.FORBIDDEN);

    const closed = await request(server())
      .post(`/api/v1/equipment/maintenance-tasks/${maintenanceTaskId}/close`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ completionNote: 'Replaced the door seal.' });
    expect(closed.status).toBe(HttpStatus.CREATED);
    expect(closed.body.data.status).toBe('pending_verification');
  });

  it('EQP-7 / PLT-1: only QA (equipment:approve) can verify — the engineer cannot; QA verification closes it', async () => {
    const signingTokenResponse = await request(server()).post('/api/v1/esign/challenge').set('Authorization', `Bearer ${engineerToken}`).send({ credential: PASSWORD });
    const engineerSigningToken = signingTokenResponse.body.data.signingToken;
    const deniedVerify = await request(server())
      .post(`/api/v1/equipment/maintenance-tasks/${maintenanceTaskId}/verify`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ signingToken: engineerSigningToken });
    expect(deniedVerify.status).toBe(HttpStatus.FORBIDDEN);

    const qaSigningTokenResponse = await request(server()).post('/api/v1/esign/challenge').set('Authorization', `Bearer ${qaToken}`).send({ credential: PASSWORD });
    const qaSigningToken = qaSigningTokenResponse.body.data.signingToken;
    const verified = await request(server())
      .post(`/api/v1/equipment/maintenance-tasks/${maintenanceTaskId}/verify`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken: qaSigningToken, note: 'Confirmed operational.' });
    expect(verified.status).toBe(HttpStatus.CREATED);
    expect(verified.body.data.status).toBe('closed');
  });

  it('EQP-7: the open-maintenance-tasks queue no longer lists the closed task', async () => {
    const open = await request(server()).get('/api/v1/equipment/maintenance-tasks/open').set('Authorization', `Bearer ${qaToken}`);
    expect(open.status).toBe(HttpStatus.OK);
    expect(open.body.data.some((t: { id: string }) => t.id === maintenanceTaskId)).toBe(false);
  });

  it('EQP-5/EQP-6: a Do Not Use equipment blocks new usage-start logging via the real HTTP path', async () => {
    const created = await request(server())
      .post('/api/v1/equipment')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ name: 'Balance', location: 'QC Lab', departmentId, isGmpCritical: false });
    const otherEquipmentId = created.body.data.id;

    const schedule = await request(server())
      .post(`/api/v1/equipment/${otherEquipmentId}/calibration-schedule`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ frequencyMonths: 12, parameters: 'Weight set', toleranceClass: 'Class F1', agencyType: 'internal', nextDueDate: '2026-01-01' });
    expect(schedule.status).toBe(HttpStatus.CREATED);

    const failRecord = await request(server())
      .post(`/api/v1/equipment/${otherEquipmentId}/calibration-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('performedDate', '2027-01-01')
      .field('result', 'fail')
      .field('impactAssessmentNote', 'Reading well beyond tolerance.')
      .attach('file', Buffer.from('%PDF-'), { filename: 'oot.pdf', contentType: 'application/pdf' });
    expect(failRecord.status).toBe(HttpStatus.CREATED);

    const blocked = await request(server())
      .post(`/api/v1/equipment/${otherEquipmentId}/logbook/usage-start`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productBatchRef: 'BATCH-200' });
    expect(blocked.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('PLT-8 tenant isolation: another tenant cannot read this equipment logbook or maintenance tasks', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const attempt = await request(server()).get(`/api/v1/equipment/${equipmentId}/logbook`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(attempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
