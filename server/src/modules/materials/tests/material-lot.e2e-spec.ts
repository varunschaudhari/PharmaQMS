import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ALL_PERMISSION_KEYS, AuditAction, PermissionAction, PermissionModule } from '@pharmaqms/shared';
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

const PASSWORD = 'Correct1!';

describe('QRX-2 Material Status Labels HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let auditEventModel: Model<AuditEventDocument>;
  let tenantId: string;
  let qaToken: string;
  let operatorToken: string;
  let lotId: string;
  let scanCode: string;

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
    const schemeModel = moduleFixture.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const qaRole = await roleModel.create({
      tenantId,
      name: 'QA Head',
      permissions: [
        `${PermissionModule.MATERIALS}:${PermissionAction.VIEW}`,
        `${PermissionModule.MATERIALS}:${PermissionAction.CREATE}`,
        `${PermissionModule.MATERIALS}:${PermissionAction.APPROVE}`,
      ],
    });
    await userModel.create({ tenantId, email: 'qa@example.com', fullName: 'Quinn Qahead', passwordHash, roleId: qaRole._id });
    const operatorRole = await roleModel.create({ tenantId, name: 'Operator', permissions: [] });
    await userModel.create({ tenantId, email: 'operator@example.com', fullName: 'Olive Operator', passwordHash, roleId: operatorRole._id });

    await schemeModel.create({ tenantId, entityType: 'MATERIAL_LOT', prefix: 'LOT', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false });

    qaToken = await login('qa@example.com');
    operatorToken = await login('operator@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('QRX-2: QA creates a lot (audited) with a numbered code and a minted QR — Quarantine by default', async () => {
    const response = await request(server())
      .post('/api/v1/materials')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ materialName: 'Lactose Monohydrate', manufacturer: 'DFE Pharma', receivedDate: '2026-07-01' });

    expect(response.status).toBe(HttpStatus.CREATED);
    lotId = response.body.data.id;
    scanCode = response.body.data.qr.code;
    expect(response.body.data.lotCode).toBe('LOT-001');
    expect(response.body.data.status).toBe('quarantine');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'MaterialLot', action: AuditAction.CREATE });
    expect(auditEvents).toHaveLength(1);
  });

  it('PLT-1: an operator without materials:create cannot create a lot', async () => {
    const response = await request(server()).post('/api/v1/materials').set('Authorization', `Bearer ${operatorToken}`).send({ materialName: 'X', receivedDate: '2026-07-01' });
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('QRX-2: ANY authenticated user can scan and view status (view-only — no change_status action for a non-QA operator)', async () => {
    const resolved = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${operatorToken}`);
    expect(resolved.status).toBe(HttpStatus.OK);
    expect(resolved.body.data.entityType).toBe('MaterialLot');
    expect(resolved.body.data.entityId).toBe(lotId);

    const scanView = await request(server()).get(`/api/v1/materials/${lotId}/scan-view`).set('Authorization', `Bearer ${operatorToken}`);
    expect(scanView.status).toBe(HttpStatus.OK);
    expect(scanView.body.data.status).toBe('quarantine');
    expect(scanView.body.data.availableActions).toEqual([]);
  });

  it('QRX-2 / Iron Rule 4: a status change is QA-permission-gated AND requires a fresh e-signature (QA Disposition)', async () => {
    const noTokenAttempt = await request(server())
      .post(`/api/v1/materials/${lotId}/status`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ status: 'under_test' });
    expect(noTokenAttempt.status).toBe(HttpStatus.UNAUTHORIZED);

    const operatorAttempt = await request(server())
      .post(`/api/v1/materials/${lotId}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ signingToken: 'irrelevant', status: 'under_test' });
    expect(operatorAttempt.status).toBe(HttpStatus.FORBIDDEN);

    const signingToken = await challenge(qaToken);
    const dispositioned = await request(server())
      .post(`/api/v1/materials/${lotId}/status`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken, status: 'under_test', note: 'Sent to QC for testing.' });
    expect(dispositioned.status).toBe(HttpStatus.CREATED);
    expect(dispositioned.body.data.status).toBe('under_test');

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'MaterialLot', action: AuditAction.MATERIAL_LOT_DISPOSITIONED });
    expect(auditEvents).toHaveLength(1);
  });

  it('QRX-2: an invalid transition (Under Test straight back to Quarantine) is rejected', async () => {
    const signingToken = await challenge(qaToken);
    const response = await request(server())
      .post(`/api/v1/materials/${lotId}/status`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken, status: 'quarantine' });
    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('QRX-2: approving the lot (e-signed), disposition details then show on the scan view for anyone', async () => {
    const signingToken = await challenge(qaToken);
    const approved = await request(server())
      .post(`/api/v1/materials/${lotId}/status`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken, status: 'approved', note: 'COA conforms — releasing.' });
    expect(approved.status).toBe(HttpStatus.CREATED);
    expect(approved.body.data.status).toBe('approved');

    const scanView = await request(server()).get(`/api/v1/materials/${lotId}/scan-view`).set('Authorization', `Bearer ${operatorToken}`);
    expect(scanView.body.data.lastDisposition.userFullName).toBe('Quinn Qahead');
    expect(scanView.body.data.lastDisposition.meaning).toBe('qa_disposition');
    // Approved is terminal — no further status change is offered, even to QA.
    const qaScanView = await request(server()).get(`/api/v1/materials/${lotId}/scan-view`).set('Authorization', `Bearer ${qaToken}`);
    expect(qaScanView.body.data.availableActions).toEqual([]);
  });

  it('QRX-2: list is tenant-scoped and paginated', async () => {
    const response = await request(server()).get('/api/v1/materials?page=1&limit=10').set('Authorization', `Bearer ${qaToken}`);
    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.meta.total).toBe(1);
  });

  it('QRX-2 (e): a rejected lot surfaces on the rejected-lots dashboard feed', async () => {
    const created = await request(server())
      .post('/api/v1/materials')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ materialName: 'Bad Batch', receivedDate: '2026-07-01' });
    const badLotId = created.body.data.id as string;

    const signingToken = await challenge(qaToken);
    await request(server())
      .post(`/api/v1/materials/${badLotId}/status`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ signingToken, status: 'rejected', note: 'Failed identification test.' });

    const feed = await request(server()).get('/api/v1/materials/rejected').set('Authorization', `Bearer ${qaToken}`);
    expect(feed.status).toBe(HttpStatus.OK);
    expect(feed.body.data.some((entry: { lotId: string }) => entry.lotId === badLotId)).toBe(true);
  });

  it('PLT-8 tenant isolation: another tenant cannot see or scan this lot', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const outsiderRole = await roleModel.create({ tenantId: otherTenant, name: 'Outsider', permissions: ALL_PERMISSION_KEYS });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await userModel.create({ tenantId: otherTenant, email: 'outsider@else.example', fullName: 'Outsider', passwordHash, roleId: outsiderRole._id });
    const outsiderLogin = await request(server()).post('/api/v1/auth/login').send({ tenantId: otherTenant, email: 'outsider@else.example', password: PASSWORD });
    const outsiderToken = outsiderLogin.body.data.tokens.accessToken as string;

    const getAttempt = await request(server()).get(`/api/v1/materials/${lotId}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(getAttempt.status).toBe(HttpStatus.NOT_FOUND);

    const scanAttempt = await request(server()).get(`/api/v1/qr/resolve/${scanCode}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(scanAttempt.status).toBe(HttpStatus.NOT_FOUND);
  });
});
