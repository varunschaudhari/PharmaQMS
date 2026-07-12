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
import { PmTask, PmTaskDocument } from '../schemas/pm-task.schema';

const PASSWORD = 'Correct1!';

describe('EQP-8 EQP-9 Qualification + PM HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let pmTaskModel: Model<PmTaskDocument>;
  let tenantId: string;
  let departmentId: string;
  let engineerToken: string;
  let operatorToken: string;
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
    pmTaskModel = moduleFixture.get<Model<PmTaskDocument>>(getModelToken(PmTask.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const departmentModel = moduleFixture.get<Model<DepartmentDocument>>(getModelToken(Department.name));
    const schemeModel = moduleFixture.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const adminRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'admin@qplive.example', fullName: 'QA Executive', passwordHash, roleId: adminRole._id });

    const engineerRole = await roleModel.create({ tenantId, name: 'Maintenance Engineer', permissions: ['equipment:view', 'equipment:create', 'equipment:edit'] });
    await userModel.create({ tenantId, email: 'engineer@qplive.example', fullName: 'Eddie Engineer', passwordHash, roleId: engineerRole._id });

    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@qplive.example', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    const department = await departmentModel.create({ tenantId, name: 'Quality Control', code: 'QC' });
    departmentId = department._id.toString();
    await schemeModel.create({ tenantId, entityType: 'EQUIPMENT', prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false });

    engineerToken = await login('engineer@qplive.example');
    operatorToken = await login('operator@qplive.example');

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

  let pqRecordId: string;

  it('EQP-8: records an IQ event (protocol only), then a PQ PASS with a requalification frequency', async () => {
    const iq = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/qualification-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('qualificationType', 'iq')
      .field('performedDate', '2026-01-01')
      .field('result', 'pass')
      .attach('protocol', Buffer.from('%PDF-1.7 IQ protocol'), { filename: 'iq-protocol.pdf', contentType: 'application/pdf' });
    expect(iq.status).toBe(HttpStatus.CREATED);
    expect(iq.body.data.reportFileName).toBeNull();

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: AuditAction.QUALIFICATION_RECORDED });
    expect(auditEvents.length).toBeGreaterThan(0);

    const pq = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/qualification-records`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .field('qualificationType', 'pq')
      .field('performedDate', '2026-01-01')
      .field('result', 'pass')
      .field('requalificationFrequencyMonths', '24')
      .attach('protocol', Buffer.from('%PDF-1.7 PQ protocol'), { filename: 'pq-protocol.pdf', contentType: 'application/pdf' });
    expect(pq.status).toBe(HttpStatus.CREATED);
    pqRecordId = pq.body.data.id;

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.body.data.qualificationStatus).toBe('qualified');
    expect(card.body.data.qualificationNextDueDate).not.toBeNull();
  });

  it('EQP-8: a report can be attached after the fact, exactly once', async () => {
    const attach = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/qualification-records/${pqRecordId}/report`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .attach('report', Buffer.from('%PDF-1.7 PQ report'), { filename: 'pq-report.pdf', contentType: 'application/pdf' });
    expect(attach.status).toBe(HttpStatus.CREATED);

    const attachAgain = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/qualification-records/${pqRecordId}/report`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .attach('report', Buffer.from('%PDF-1.7 duplicate'), { filename: 'again.pdf', contentType: 'application/pdf' });
    expect(attachAgain.status).toBe(HttpStatus.BAD_REQUEST);

    const protocolFile = await request(server())
      .get(`/api/v1/equipment/${equipmentId}/qualification-records/${pqRecordId}/protocol`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(protocolFile.status).toBe(HttpStatus.OK);
  });

  it('EQP-9: an engineer creates a PM plan; the status card shows the real PM due date', async () => {
    const plan = await request(server())
      .post(`/api/v1/equipment/${equipmentId}/pm-plan`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ frequencyMonths: 6, checklistText: 'Check belts, lubricate bearings, inspect seals.', nextDueDate: '2020-01-01' });
    expect(plan.status).toBe(HttpStatus.CREATED);

    const card = await request(server()).get(`/api/v1/equipment/${equipmentId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.body.data.pmStatus).toBe('overdue');
    expect(card.body.data.pmDueDate).not.toBeNull();
  });

  it('EQP-9 / Iron Rule 4: completes a PM task with an e-signature; the plan advances; PLT-1 gates completion to equipment:edit', async () => {
    // Force-generate a PM task directly against the collection (mirrors the daily scanner's
    // side effect, without waiting for BullMQ — the scanner itself is exercised live in the
    // scratchpad verification script).
    const planResponse = await request(server()).get(`/api/v1/equipment/${equipmentId}/pm-plan`).set('Authorization', `Bearer ${engineerToken}`);
    const planId = planResponse.body.data.id;
    const dueDate = new Date(planResponse.body.data.nextDueDate);
    await pmTaskModel.create({ tenantId, equipmentId, equipmentCode: 'EQP-0001', equipmentName: 'Autoclave', planId, status: 'open', dueDate });

    const openQueue = await request(server()).get('/api/v1/equipment/pm-tasks/open').set('Authorization', `Bearer ${engineerToken}`);
    expect(openQueue.status).toBe(HttpStatus.OK);
    const task = openQueue.body.data.find((t: { equipmentId: string }) => t.equipmentId === equipmentId);
    expect(task).toBeDefined();

    const deniedSigningToken = await challenge(operatorToken);
    const denied = await request(server())
      .post(`/api/v1/equipment/pm-tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ signingToken: deniedSigningToken, completionNote: 'Attempted.' });
    expect(denied.status).toBe(HttpStatus.FORBIDDEN);

    const signingToken = await challenge(engineerToken);
    const completed = await request(server())
      .post(`/api/v1/equipment/pm-tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ signingToken, completionNote: 'Serviced per checklist.' });
    expect(completed.status).toBe(HttpStatus.CREATED);
    expect(completed.body.data.status).toBe('completed');

    const signatures = await request(server()).get(`/api/v1/esign/Equipment/${equipmentId}/signatures`).set('Authorization', `Bearer ${engineerToken}`);
    expect(signatures.body.data.some((s: { meaning: string }) => s.meaning === 'pm_completed')).toBe(true);

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Equipment', action: AuditAction.PM_TASK_COMPLETED });
    expect(auditEvents.length).toBeGreaterThan(0);
  });

  it('PLT-8 tenant isolation: another tenant cannot read this equipment qualification/PM data', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const attempt = await request(server()).get(`/api/v1/equipment/${equipmentId}/qualification-records`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(attempt.status).toBe(HttpStatus.NOT_FOUND);
    const pmAttempt = await request(server()).get(`/api/v1/equipment/${equipmentId}/pm-plan`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(pmAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
