import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../../auth/schemas/role.schema';
import { User, UserDocument } from '../../auth/schemas/user.schema';

describe('PLT-2 Audit HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let accessToken: string;

  async function login(password: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'qa.head@example.com', password });
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const role = await roleModel.create({ tenantId, name: 'QA Head', permissions: ['documents:approve'] });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({
      tenantId,
      email: 'qa.head@example.com',
      fullName: 'QA Head',
      passwordHash,
      roleId: role._id,
    });

    const loginResponse = await login('Correct1!');
    accessToken = loginResponse.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-2: a successful login writes a LOGIN_SUCCESS audit event visible in that user\'s history', async () => {
    const userIdResponse = await login('Correct1!');
    const userId = userIdResponse.body.data.user.userId;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userId}/history`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data[0]).toMatchObject({ action: 'login_success', entityType: 'User', entityId: userId });
    expect(response.body.meta).toMatchObject({ page: 1, limit: 20 });
  });

  it('PLT-2: repeated failed logins write LOGIN_FAILURE events then an ACCOUNT_LOCKED event', async () => {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const role = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const user = await userModel.create({
      tenantId,
      email: 'operator@example.com',
      fullName: 'Operator',
      passwordHash,
      roleId: role._id,
    });
    const userId = user._id.toString();

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId, email: 'operator@example.com', password: 'wrong' });
    }

    const response = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userId}/history`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ limit: 10 });

    expect(response.body.meta.total).toBe(5);
    expect(response.body.data[0].action).toBe('account_locked');
    expect(response.body.data[1].action).toBe('login_failure');
  });

  it('PLT-2: change-password writes a PASSWORD_CHANGED audit event and is queryable via history', async () => {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const role = await roleModel.create({ tenantId, name: 'ChangePwRole', permissions: [] });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const user = await userModel.create({
      tenantId,
      email: 'changepw@example.com',
      fullName: 'Change Pw',
      passwordHash,
      roleId: role._id,
    });
    const userId = user._id.toString();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'changepw@example.com', password: 'Correct1!' });
    const token = loginResponse.body.data.tokens.accessToken;

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Correct1!', newPassword: 'NewPassw0rd!' });

    expect(changeResponse.status).toBe(HttpStatus.OK);
    expect(changeResponse.body.data).toEqual({ success: true });
    expect(changeResponse.body.audit).toBeUndefined();

    const history = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userId}/history`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(history.body.data.some((event: { action: string }) => event.action === 'password_changed')).toBe(true);
  });

  it('PLT-2: history is scoped per tenant — tenant A cannot see tenant B\'s audit events', async () => {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

    const tenantBId = new mongoose.Types.ObjectId().toString();
    const roleB = await roleModel.create({ tenantId: tenantBId, name: 'QA Head B', permissions: [] });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const userB = await userModel.create({
      tenantId: tenantBId,
      email: 'qa.head.b@example.com',
      fullName: 'QA Head B',
      passwordHash,
      roleId: roleB._id,
    });

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenantBId, email: 'qa.head.b@example.com', password: 'Correct1!' });
    const tokenB = loginB.body.data.tokens.accessToken;

    // Tenant B's own token can see its own history...
    const ownHistory = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userB._id.toString()}/history`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(ownHistory.body.meta.total).toBeGreaterThan(0);

    // ...but tenant A's token, querying the SAME entityId under tenant A's context, sees nothing —
    // CurrentTenant() always derives tenantId from the caller's own JWT, never trusting the URL.
    const crossTenantHistory = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userB._id.toString()}/history`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(crossTenantHistory.body.meta.total).toBe(0);
    expect(crossTenantHistory.body.data).toEqual([]);
  });

  it('PLT-2: history endpoint rejects unauthenticated requests', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/audit/User/some-id/history');
    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-2: GET /audit/:entityType/:entityId/history/export returns a CSV file', async () => {
    const userIdResponse = await login('Correct1!');
    const userId = userIdResponse.body.data.user.userId;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/audit/User/${userId}/history/export`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.split('\n')[0]).toBe('occurredAt,actorName,action,entityType,entityId,reason,changes');
    expect(response.text).toContain('login_success');
  });

  it('PLT-2: GET /audit/:entityType/export returns a CSV file for the whole module', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit/User/export')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('login_success');
  });
});
