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
import { NumberingScheme, NumberingSchemeDocument } from '../../../platform/numbering/schemas/numbering-scheme.schema';

describe('QRX-1 Rooms & Cleaning Logs HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let adminToken: string;
  let operatorToken: string;
  let roomId: string;
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
    const schemeModel = moduleFixture.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const adminRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'admin@example.com', fullName: 'QA Executive', passwordHash, roleId: adminRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    await schemeModel.create({ tenantId, entityType: 'ROOM', prefix: 'ROOM', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false });

    adminToken = await login('admin@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('QRX-1: creates a room (audited) with a numbered code and a minted QR', async () => {
    const response = await request(server())
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Granulation Room', block: 'Block A', classification: 'controlled' });

    expect(response.status).toBe(HttpStatus.CREATED);
    roomId = response.body.data.id;
    scanCode = response.body.data.qr.code;
    expect(response.body.data.roomCode).toBe('ROOM-001');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Room', action: AuditAction.CREATE });
    expect(auditEvents).toHaveLength(1);
  });

  it('PLT-1: an operator without rooms:create cannot create a room', async () => {
    const response = await request(server()).post('/api/v1/rooms').set('Authorization', `Bearer ${operatorToken}`).send({ name: 'X' });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('QRX-1: ANY authenticated user can open the status card via the QR resolve + status-card endpoints', async () => {
    const resolved = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${operatorToken}`);
    expect(resolved.status).toBe(HttpStatus.OK);
    expect(resolved.body.data.entityType).toBe('Room');
    expect(resolved.body.data.entityId).toBe(roomId);

    const card = await request(server()).get(`/api/v1/rooms/${roomId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.status).toBe(HttpStatus.OK);
    expect(card.body.data.cleaningStatus).toBe('not_scheduled');
    expect(card.body.data.availableActions).toEqual(['log_cleaning']);
  });

  it('QRX-1: QA configures a cleaning schedule, then an operator logs a cleaning entry (authenticated, no elevated permission)', async () => {
    const schedule = await request(server())
      .post(`/api/v1/rooms/${roomId}/cleaning-schedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ routineFrequency: 'daily', fullCleaningIntervalDays: 7, nextRoutineDueDate: '2020-01-01T00:00:00.000Z', nextFullDueDate: '2020-01-01T00:00:00.000Z' });
    expect(schedule.status).toBe(HttpStatus.CREATED);

    const logged = await request(server())
      .post(`/api/v1/rooms/${roomId}/cleaning-entries`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ cleaningType: 'routine', remarks: 'Floor and surfaces wiped.' });
    expect(logged.status).toBe(HttpStatus.CREATED);
    expect(logged.body.data.entryType).toBe('cleaning');

    const card = await request(server()).get(`/api/v1/rooms/${roomId}/status-card`).set('Authorization', `Bearer ${operatorToken}`);
    expect(card.body.data.lastCleaningEntry.id).toBe(logged.body.data.id);
  });

  it('QRX-1: a correction is a NEW amendment entry, and the overdue room now surfaces on the cleaning-due feed', async () => {
    const dueBefore = await request(server()).get('/api/v1/rooms/cleaning/due').set('Authorization', `Bearer ${adminToken}`);
    expect(dueBefore.status).toBe(HttpStatus.OK);
    expect(dueBefore.body.data.some((entry: { roomId: string }) => entry.roomId === roomId)).toBe(true);

    const entries = await request(server()).get(`/api/v1/rooms/${roomId}/cleaning-entries`).set('Authorization', `Bearer ${operatorToken}`);
    const originalEntryId = entries.body.data[0].id as string;

    const amendment = await request(server())
      .post(`/api/v1/rooms/${roomId}/cleaning-entries/${originalEntryId}/amend`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ amendsEntryId: originalEntryId, description: 'Wrong cleaning type — should have been Full.' });
    expect(amendment.status).toBe(HttpStatus.CREATED);
    expect(amendment.body.data.entryType).toBe('amendment');
    expect(amendment.body.data.amendsEntryId).toBe(originalEntryId);
  });

  it('QRX-1: a status transition follows the map — Active to Retired is audited, Retired to Active is rejected', async () => {
    const retired = await request(server())
      .post(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'retired', reason: 'Decommissioned.' });
    expect(retired.status).toBe(HttpStatus.CREATED);
    expect(retired.body.data.status).toBe('retired');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'Room', action: AuditAction.STATUS_CHANGE });
    expect(auditEvents).toHaveLength(1);

    const invalid = await request(server())
      .post(`/api/v1/rooms/${roomId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(invalid.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('QRX-1: list is tenant-scoped and paginated', async () => {
    const response = await request(server()).get('/api/v1/rooms?page=1&limit=10').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.meta.total).toBe(1);
  });

  it('PLT-8 tenant isolation: another tenant cannot see or scan this room', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: 'Correct1!' });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const getAttempt = await request(server()).get(`/api/v1/rooms/${roomId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(getAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const scanAttempt = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(scanAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
