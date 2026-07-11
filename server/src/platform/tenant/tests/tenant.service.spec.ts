import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CredentialType } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { Tenant, TenantDocument, TenantSchema } from '../schemas/tenant.schema';
import { TenantService } from '../tenant.service';

describe('PLT-8 TenantService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let tenantService: TenantService;
  let tenantModel: Model<TenantDocument>;
  let roleModel: Model<RoleDocument>;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Tenant.name, schema: TenantSchema },
          { name: Role.name, schema: RoleSchema },
          { name: User.name, schema: UserSchema },
        ]),
      ],
      providers: [TenantService],
    }).compile();

    tenantService = moduleRef.get(TenantService);
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    roleModel = moduleRef.get(getModelToken(Role.name));
    userModel = moduleRef.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await tenantModel.collection.deleteMany({});
    await roleModel.collection.deleteMany({});
    await userModel.collection.deleteMany({});
  });

  it('PLT-8: provisionTenant() creates the tenant, a full-permission Tenant Admin role, and the first user', async () => {
    const tenant = await tenantService.provisionTenant({
      name: 'Acme Pharma',
      slug: 'acme-pharma',
      initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
    });

    expect(tenant.name).toBe('Acme Pharma');
    expect(tenant.settings.timezone).toBe('Asia/Kolkata');
    expect(tenant.settings.signatureCredentialType).toBe(CredentialType.PASSWORD);

    const role = await roleModel.findOne({ tenantId: tenant.id });
    expect(role).not.toBeNull();
    expect(role?.permissions.length).toBeGreaterThan(0);

    const user = await userModel.findOne({ tenantId: tenant.id }).select('+passwordHash');
    expect(user?.email).toBe('admin@acme.example');
    expect(await bcrypt.compare('Correct1!', user!.passwordHash)).toBe(true);
    expect(user?.roleId.toString()).toBe(role?._id.toString());
  });

  it('PLT-8: provisionTenant() rejects a duplicate slug', async () => {
    await tenantService.provisionTenant({
      name: 'Acme Pharma',
      slug: 'acme-pharma',
      initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
    });

    await expect(
      tenantService.provisionTenant({
        name: 'Acme Pharma Two',
        slug: 'acme-pharma',
        initialAdmin: { email: 'admin2@acme.example', fullName: 'Acme Admin 2', password: 'Correct1!' },
      }),
    ).rejects.toThrow(AppException);
  });

  it('PLT-8: provisionTenant() applies partial settings overrides on top of defaults', async () => {
    const tenant = await tenantService.provisionTenant({
      name: 'Acme Pharma',
      slug: 'acme-pharma',
      settings: { timezone: 'America/New_York', accessTokenTtlMinutes: 30 },
      initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
    });

    expect(tenant.settings.timezone).toBe('America/New_York');
    expect(tenant.settings.accessTokenTtlMinutes).toBe(30);
    // Unspecified fields still get their defaults.
    expect(tenant.settings.refreshTokenTtlHoursDefault).toBe(12);
  });

  it('PLT-8: updateSettings() applies a partial update and reports before/after', async () => {
    const tenant = await tenantService.provisionTenant({
      name: 'Acme Pharma',
      slug: 'acme-pharma',
      initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
    });

    const { before, after } = await tenantService.updateSettings(tenant.id, { accessTokenTtlMinutes: 60 });
    expect(before.accessTokenTtlMinutes).toBe(15);
    expect(after.settings.accessTokenTtlMinutes).toBe(60);
  });

  it('PLT-8: listTenants() and findById() return provisioned tenants', async () => {
    await tenantService.provisionTenant({
      name: 'Acme Pharma',
      slug: 'acme-pharma',
      initialAdmin: { email: 'admin@acme.example', fullName: 'Acme Admin', password: 'Correct1!' },
    });

    const tenants = await tenantService.listTenants();
    expect(tenants).toHaveLength(1);
    expect(await tenantService.findById(tenants[0].id)).toMatchObject({ slug: 'acme-pharma' });
  });
});
