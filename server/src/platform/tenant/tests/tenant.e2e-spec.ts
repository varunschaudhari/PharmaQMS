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

describe('PLT-8 Tenant/Department/User admin HTTP surface', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let bootstrapTenantId: string;
  let platformAdminToken: string;
  let regularUserToken: string;

  async function login(tenantId: string, email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email, password });
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

    const userModel = moduleFixture.get<Model<UserDocument>>(getModelToken(User.name));
    const roleModel = moduleFixture.get<Model<RoleDocument>>(getModelToken(Role.name));

    // Simulates the one-time manual bootstrap of the very first platform admin (in production
    // this is a direct DB seed, never an HTTP endpoint — see TenantController comment).
    // isPlatformAdmin is orthogonal to the tenant-scoped permission matrix (PlatformAdminGuard
    // gates /tenants; PermissionsGuard still separately gates tenant-scoped admin endpoints
    // like /admin/users) — grant admin:view so this role can exercise both in this test.
    bootstrapTenantId = new mongoose.Types.ObjectId().toString();
    const bootstrapRole = await roleModel.create({
      tenantId: bootstrapTenantId,
      name: 'Bootstrap',
      permissions: ['admin:view'],
    });
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    await userModel.create({
      tenantId: bootstrapTenantId,
      email: 'platform.admin@pharmaqms.internal',
      fullName: 'Platform Admin',
      passwordHash,
      roleId: bootstrapRole._id,
      isPlatformAdmin: true,
    });
    await userModel.create({
      tenantId: bootstrapTenantId,
      email: 'regular.user@pharmaqms.internal',
      fullName: 'Regular User',
      passwordHash,
      roleId: bootstrapRole._id,
      isPlatformAdmin: false,
    });

    platformAdminToken = await login(bootstrapTenantId, 'platform.admin@pharmaqms.internal', 'Correct1!');
    regularUserToken = await login(bootstrapTenantId, 'regular.user@pharmaqms.internal', 'Correct1!');
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('PLT-8: POST /tenants rejects a non-platform-admin session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${regularUserToken}`)
      .send({
        name: 'Acme Pharma',
        slug: 'acme-pharma',
        initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
      });

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('PLT-8: provisions a tenant, its admin can log in, and manage departments/users end-to-end', async () => {
    const createTenantResponse = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        name: 'Acme Pharma',
        slug: 'acme-pharma',
        settings: { timezone: 'Asia/Kolkata' },
        initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
      });
    expect(createTenantResponse.status).toBe(HttpStatus.CREATED);
    const tenantId = createTenantResponse.body.data.id as string;

    const adminToken = await login(tenantId, 'admin@acme.example', 'Correct1!');
    expect(adminToken).toEqual(expect.any(String));

    // Department CRUD.
    const createDeptResponse = await request(app.getHttpServer())
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Quality Assurance', code: 'qa' });
    expect(createDeptResponse.status).toBe(HttpStatus.CREATED);
    expect(createDeptResponse.body.data.code).toBe('QA');
    const departmentId = createDeptResponse.body.data.id as string;

    // Role listing (needed to assign a role to a new user).
    const rolesResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/users/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(rolesResponse.body.data.some((role: { name: string }) => role.name === 'Tenant Admin')).toBe(true);
    const roleId = rolesResponse.body.data[0].id as string;

    // User CRUD with role + department assignment.
    const createUserResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'operator@acme.example',
        fullName: 'Operator One',
        password: 'Correct1!',
        roleId,
        departmentId,
      });
    expect(createUserResponse.status).toBe(HttpStatus.CREATED);
    const userId = createUserResponse.body.data.id as string;

    const updateUserResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(updateUserResponse.status).toBe(HttpStatus.OK);
    expect(updateUserResponse.body.data.isActive).toBe(false);

    // Audit wiring: department creation shows up in its own history via @Audited().
    const historyResponse = await request(app.getHttpServer())
      .get(`/api/v1/audit/Department/${departmentId}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(historyResponse.body.data).toHaveLength(1);
    expect(historyResponse.body.data[0]).toMatchObject({ action: 'create', actorName: 'Acme Admin' });

    // Tenant isolation: the bootstrap tenant's admin cannot see Acme Pharma's users/departments.
    const crossTenantUsers = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${platformAdminToken}`);
    expect(crossTenantUsers.body.data.some((u: { id: string }) => u.id === userId)).toBe(false);
  });

  it('PLT-8: GET /tenants/:id rejects a non-platform-admin session', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${bootstrapTenantId}`)
      .set('Authorization', `Bearer ${regularUserToken}`);
    expect(response.status).toBe(HttpStatus.FORBIDDEN);
  });
});
