import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';

describe('PLT-1 Auth HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let tenantId: string;

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
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-1: POST /auth/login succeeds with correct credentials and returns tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'qa.head@example.com', password: 'Correct1!' });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(response.body.data.tokens.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.user.email).toBe('qa.head@example.com');
    expect(response.body.data.user.tenantId).toBe(tenantId);
  });

  it('PLT-1: POST /auth/login rejects an incorrect password with AUTH_INVALID_CREDENTIALS', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'qa.head@example.com', password: 'wrong-password' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('PLT-1: POST /auth/login returns a validation error for a malformed email', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'not-an-email', password: 'Correct1!' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PLT-1: POST /auth/refresh returns new tokens for a valid refresh token', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: 'qa.head@example.com', password: 'Correct1!' });
    const { refreshToken } = loginResponse.body.data.tokens;

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(HttpStatus.OK);
    expect(refreshResponse.body.data.tokens.refreshToken).not.toBe(refreshToken);
  });

  it('PLT-1: POST /auth/refresh rejects a malformed refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body.error.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
  });

  it('PLT-1: POST /auth/refresh returns a validation error when refreshToken is missing', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({});

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
