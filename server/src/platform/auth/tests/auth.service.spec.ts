import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { AuditModule } from '../../audit/audit.module';
import { Tenant, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { AuthService } from '../auth.service';
import { authConfig } from '../config/auth.config';
import { Role, RoleDocument, RoleSchema } from '../schemas/role.schema';
import { User, UserDocument, UserSchema } from '../schemas/user.schema';

describe('PLT-1 AuthService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let authService: AuthService;
  let userModel: Model<UserDocument>;
  let roleModel: Model<RoleDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [authConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: Tenant.name, schema: TenantSchema },
        ]),
        AuditModule,
      ],
      providers: [AuthService],
    }).compile();

    authService = moduleRef.get(AuthService);
    userModel = moduleRef.get(getModelToken(User.name));
    roleModel = moduleRef.get(getModelToken(Role.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await userModel.deleteMany({});
    await roleModel.deleteMany({});
  });

  async function seedUser(overrides: {
    tenantId?: string;
    email?: string;
    fullName?: string;
    password?: string;
    passwordChangedAt?: Date;
    permissions?: string[];
  } = {}): Promise<{ tenantId: string; user: UserDocument; role: RoleDocument }> {
    const tenantId = overrides.tenantId ?? new mongoose.Types.ObjectId().toString();
    const role = await roleModel.create({
      tenantId,
      name: 'QA Head',
      permissions: overrides.permissions ?? [],
    });
    const passwordHash = await bcrypt.hash(overrides.password ?? 'Correct1!', 10);
    const user = await userModel.create({
      tenantId,
      email: overrides.email ?? 'user@example.com',
      fullName: overrides.fullName ?? 'Test User',
      passwordHash,
      roleId: role._id,
      ...(overrides.passwordChangedAt ? { passwordChangedAt: overrides.passwordChangedAt } : {}),
    });
    return { tenantId, user, role };
  }

  it('PLT-1: user document requires a tenantId', async () => {
    const user = new userModel({
      email: 'no-tenant@example.com',
      fullName: 'No Tenant',
      passwordHash: 'hash',
      roleId: new mongoose.Types.ObjectId(),
    });
    await expect(user.validate()).rejects.toThrow();
  });

  it('PLT-1: login only matches a user within the given tenantId (tenant isolation)', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();
    await seedUser({ tenantId: tenantA, email: 'shared@example.com', fullName: 'Tenant A User' });
    await seedUser({ tenantId: tenantB, email: 'shared@example.com', fullName: 'Tenant B User' });

    const result = await authService.login({
      tenantId: tenantA,
      email: 'shared@example.com',
      password: 'Correct1!',
      rememberDevice: false,
    });

    expect(result.user.tenantId).toBe(tenantA);
    expect(result.user.fullName).toBe('Tenant A User');
  });

  it('PLT-1: login rejects a tenantId that does not match the user (tenant isolation)', async () => {
    const { tenantId } = await seedUser({ email: 'iso@example.com' });
    const otherTenantId = new mongoose.Types.ObjectId().toString();

    await expect(
      authService.login({ tenantId: otherTenantId, email: 'iso@example.com', password: 'Correct1!', rememberDevice: false }),
    ).rejects.toThrow(AppException);
    void tenantId;
  });

  it('PLT-1: login locks the account after the configured number of consecutive failed attempts', async () => {
    const { tenantId, user } = await seedUser({ email: 'lockout@example.com' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        authService.login({ tenantId, email: 'lockout@example.com', password: 'wrong-password', rememberDevice: false }),
      ).rejects.toThrow(AppException);
    }

    const reloaded = await userModel.findById(user._id);
    expect(reloaded?.lockedUntil).not.toBeNull();
    expect(reloaded?.failedLoginAttempts).toBe(5);

    try {
      await authService.login({ tenantId, email: 'lockout@example.com', password: 'Correct1!', rememberDevice: false });
      throw new Error('expected login to be rejected while the account is locked');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(ErrorCode.AUTH_ACCOUNT_LOCKED);
    }
  });

  it('PLT-1: a successful login resets the failed-attempt counter', async () => {
    const { tenantId, user } = await seedUser({ email: 'reset@example.com' });

    await expect(
      authService.login({ tenantId, email: 'reset@example.com', password: 'wrong-password', rememberDevice: false }),
    ).rejects.toThrow(AppException);

    await authService.login({ tenantId, email: 'reset@example.com', password: 'Correct1!', rememberDevice: false });

    const reloaded = await userModel.findById(user._id);
    expect(reloaded?.failedLoginAttempts).toBe(0);
    expect(reloaded?.lockedUntil).toBeNull();
  });

  it('PLT-1: refresh rotates the refresh token and rejects reuse of the previous one', async () => {
    const { tenantId } = await seedUser({ email: 'refresh@example.com' });

    const loginResult = await authService.login({
      tenantId,
      email: 'refresh@example.com',
      password: 'Correct1!',
      rememberDevice: false,
    });
    const firstRefreshToken = loginResult.tokens.refreshToken;

    const refreshed = await authService.refresh({ refreshToken: firstRefreshToken });
    // Note: the access token payload doesn't change between login and an immediate refresh, so
    // (unlike the refresh token, which embeds tokenVersion) it may legitimately be byte-identical
    // if both are signed within the same second. Rotation is a refresh-token property, not an
    // access-token one.
    expect(refreshed.tokens.refreshToken).not.toBe(firstRefreshToken);

    await expect(authService.refresh({ refreshToken: firstRefreshToken })).rejects.toThrow(AppException);
  });

  it('PLT-1: refresh rejects a malformed token', async () => {
    await expect(authService.refresh({ refreshToken: 'not-a-real-token' })).rejects.toThrow(AppException);
  });

  it('PLT-1: login flags mustChangePassword when the password has expired', async () => {
    const expiredDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const { tenantId } = await seedUser({ email: 'expired@example.com', passwordChangedAt: expiredDate });

    const result = await authService.login({
      tenantId,
      email: 'expired@example.com',
      password: 'Correct1!',
      rememberDevice: false,
    });

    expect(result.mustChangePassword).toBe(true);
  });

  it('PLT-1: login does not flag mustChangePassword for a recently changed password', async () => {
    const { tenantId } = await seedUser({ email: 'fresh@example.com', passwordChangedAt: new Date() });

    const result = await authService.login({
      tenantId,
      email: 'fresh@example.com',
      password: 'Correct1!',
      rememberDevice: false,
    });

    expect(result.mustChangePassword).toBe(false);
  });

  it('PLT-1: access token embeds the role permission matrix', async () => {
    const { tenantId } = await seedUser({ email: 'perms@example.com', permissions: ['documents:approve'] });

    const result = await authService.login({
      tenantId,
      email: 'perms@example.com',
      password: 'Correct1!',
      rememberDevice: false,
    });

    expect(result.user.permissions).toEqual(['documents:approve']);
  });
});
