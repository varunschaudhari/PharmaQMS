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

describe('PLT-3 E-Signature HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;
  let accessToken: string;

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

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'qa.head@example.com', password: 'Correct1!' });
    accessToken = loginResponse.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-3: POST /esign/challenge issues a signing token for the correct password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'Correct1!' });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data.signingToken).toEqual(expect.any(String));
  });

  it('PLT-3: POST /esign/challenge rejects an incorrect password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'wrong-password' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('PLT-3: POST /esign/challenge rejects requests without a valid session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .send({ credential: 'Correct1!' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-3: creating a signature without a signingToken is rejected (session-only signing rejected)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/signatures')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        meaning: 'approved_by',
        entityType: 'Document',
        entityId: 'doc-1',
        entitySnapshot: { title: 'SOP-1' },
      });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-3: signs an entity, records the meaning, and rejects reuse of the signing token', async () => {
    const challengeResponse = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'Correct1!' });
    const { signingToken } = challengeResponse.body.data;

    const signResponse = await request(app.getHttpServer())
      .post('/api/v1/esign/signatures')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        signingToken,
        meaning: 'approved_by',
        entityType: 'Document',
        entityId: 'doc-42',
        entitySnapshot: { title: 'SOP-42', version: 1 },
        reason: 'Final approval',
      });

    expect(signResponse.status).toBe(HttpStatus.CREATED);
    expect(signResponse.body.data).toMatchObject({
      meaning: 'approved_by',
      entityType: 'Document',
      entityId: 'doc-42',
      reason: 'Final approval',
      userFullName: 'QA Head',
    });

    const historyResponse = await request(app.getHttpServer())
      .get('/api/v1/esign/Document/doc-42/signatures')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(historyResponse.body.data).toHaveLength(1);
    expect(historyResponse.body.data[0].meaning).toBe('approved_by');

    // Single-use: the SAME signingToken cannot sign a second time.
    const replayResponse = await request(app.getHttpServer())
      .post('/api/v1/esign/signatures')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        signingToken,
        meaning: 'reviewed_by',
        entityType: 'Document',
        entityId: 'doc-42',
        entitySnapshot: { title: 'SOP-42', version: 1 },
      });
    expect(replayResponse.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-3: rejects a malformed create-signature payload (unknown meaning)', async () => {
    const challengeResponse = await request(app.getHttpServer())
      .post('/api/v1/esign/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ credential: 'Correct1!' });
    const { signingToken } = challengeResponse.body.data;

    const response = await request(app.getHttpServer())
      .post('/api/v1/esign/signatures')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        signingToken,
        meaning: 'not_a_real_meaning',
        entityType: 'Document',
        entityId: 'doc-1',
        entitySnapshot: {},
      });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
