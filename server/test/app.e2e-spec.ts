import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('PLT-0 scaffold smoke test', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let connection: Connection;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    // AppModule wires its own MongooseModule.forRootAsync from MONGODB_URI (PLT-1) — point it
    // at the in-memory instance instead of injecting a second, duplicate connection.
    process.env.MONGODB_URI = mongod.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    connection = moduleFixture.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-0: Mongoose connects to the in-memory MongoDB instance', () => {
    expect(connection.readyState).toBe(1);
  });

  it('PLT-0: GET /api/v1/health returns ok via Supertest', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
