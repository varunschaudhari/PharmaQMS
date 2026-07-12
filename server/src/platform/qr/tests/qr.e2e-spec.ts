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
import { AuditEvent, AuditEventDocument } from '../../audit/schemas/audit-event.schema';
import { Role, RoleDocument } from '../../auth/schemas/role.schema';
import { User, UserDocument } from '../../auth/schemas/user.schema';

describe('PLT-7 QR HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let operatorToken: string;
  let otherTenantToken: string;
  let scanCode: string;

  async function login(tenant: string, email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenant, email, password: 'Correct1!' });
    return response.body.data.tokens.accessToken as string;
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

    auditEventModel = moduleFixture.get<Model<AuditEventDocument>>(getModelToken(AuditEvent.name));
    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    otherTenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash('Correct1!', 10);

    const adminRole = await roleModel.create({ tenantId, name: 'Tenant Admin', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId, email: 'admin@example.com', fullName: 'Admin', passwordHash, roleId: adminRole._id });

    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Operator', passwordHash, roleId: operatorRole._id });

    const otherRole = await roleModel.create({ tenantId: otherTenantId, name: 'Other Admin', permissions: ALL_PERMISSION_KEYS });
    await userModel.create({ tenantId: otherTenantId, email: 'other@example.com', fullName: 'Other', passwordHash, roleId: otherRole._id });

    adminToken = await login(tenantId, 'admin@example.com');
    operatorToken = await login(tenantId, 'operator@example.com');
    otherTenantToken = await login(otherTenantId, 'other@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-7: an admin mints a QR code for an entity, and the creation is audited', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/qr/codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'Equipment', entityId: 'eqp-http-1', entityCode: 'EQP-0042', entityName: 'pH Meter' });

    expect(response.status).toBe(HttpStatus.CREATED);
    scanCode = response.body.data.code;
    expect(scanCode).toMatch(/^[A-Z2-9]{10}$/);
    expect(response.body.data.scanUrl).toContain(`/s/${scanCode}`);

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'QrCode', action: AuditAction.CREATE });
    expect(auditEvents).toHaveLength(1);
  });

  it('PLT-7: a non-admin cannot mint codes over HTTP', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/qr/codes')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ entityType: 'Equipment', entityId: 'eqp-http-2', entityCode: 'EQP-0043', entityName: 'Balance' });

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-7: any authenticated user in the tenant resolves the code to its entity', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/qr/resolve/${scanCode}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data).toMatchObject({
      entityType: 'Equipment',
      entityId: 'eqp-http-1',
      entityCode: 'EQP-0042',
      entityName: 'pH Meter',
    });
  });

  it('PLT-7: a user from another tenant scanning the code gets 404 (cross-tenant scan blocked)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/qr/resolve/${scanCode}`)
      .set('Authorization', `Bearer ${otherTenantToken}`);

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('PLT-7: unauthenticated resolution is rejected', async () => {
    const response = await request(app.getHttpServer()).get(`/api/v1/qr/resolve/${scanCode}`);
    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('PLT-7: the QR PNG endpoint streams a PNG image', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/qr/codes/${scanCode}/png`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.headers['content-type']).toBe('image/png');
    expect((response.body as Buffer).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('PLT-7: the label PDF endpoint renders single and A4-grid PDFs', async () => {
    for (const size of ['single', 'a4'] as const) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/qr/codes/${scanCode}/label.pdf?size=${size}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect((response.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  }, 120000);
});
