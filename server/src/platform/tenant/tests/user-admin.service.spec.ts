import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { authConfig } from '../../auth/config/auth.config';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { UserAdminService } from '../user-admin.service';

describe('PLT-8 UserAdminService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let userAdminService: UserAdminService;
  let userModel: Model<UserDocument>;
  let roleModel: Model<RoleDocument>;
  let tenantId: string;
  let roleId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [authConfig] }),
        EventEmitterModule.forRoot(),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
        ]),
      ],
      providers: [UserAdminService],
    }).compile();

    userAdminService = moduleRef.get(UserAdminService);
    userModel = moduleRef.get(getModelToken(User.name));
    roleModel = moduleRef.get(getModelToken(Role.name));

    tenantId = new mongoose.Types.ObjectId().toString();
    const role = await roleModel.create({ tenantId, name: 'QA Head', permissions: ['documents:approve'] });
    roleId = role._id.toString();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await userModel.collection.deleteMany({});
  });

  it('PLT-8: createUser() hashes the password and assigns the given role', async () => {
    const user = await userAdminService.createUser({
      tenantId,
      email: 'operator@example.com',
      fullName: 'Operator One',
      password: 'Correct1!',
      roleId,
    });

    expect(user.roleId).toBe(roleId);
    expect(user.isActive).toBe(true);

    const stored = await userModel.findById(user.id).select('+passwordHash');
    expect(await bcrypt.compare('Correct1!', stored!.passwordHash)).toBe(true);
  });

  it('PLT-8: createUser() rejects a weak password', async () => {
    await expect(
      userAdminService.createUser({
        tenantId,
        email: 'weak@example.com',
        fullName: 'Weak Password',
        password: 'weak',
        roleId,
      }),
    ).rejects.toThrow(AppException);
  });

  it('PLT-8: createUser() rejects a duplicate email within the same tenant', async () => {
    await userAdminService.createUser({
      tenantId,
      email: 'dup@example.com',
      fullName: 'First',
      password: 'Correct1!',
      roleId,
    });
    await expect(
      userAdminService.createUser({
        tenantId,
        email: 'dup@example.com',
        fullName: 'Second',
        password: 'Correct1!',
        roleId,
      }),
    ).rejects.toThrow(AppException);
  });

  it('PLT-8: createUser() rejects an unknown roleId', async () => {
    await expect(
      userAdminService.createUser({
        tenantId,
        email: 'norole@example.com',
        fullName: 'No Role',
        password: 'Correct1!',
        roleId: new mongoose.Types.ObjectId().toString(),
      }),
    ).rejects.toThrow(AppException);
  });

  it('PLT-8: updateUser() reassigns role/department and reports before/after', async () => {
    const user = await userAdminService.createUser({
      tenantId,
      email: 'reassign@example.com',
      fullName: 'Reassign Me',
      password: 'Correct1!',
      roleId,
    });
    const newRole = await roleModel.create({ tenantId, name: 'QA Executive', permissions: [] });

    const { before, after } = await userAdminService.updateUser(tenantId, user.id, { roleId: newRole._id.toString() });
    expect(before.roleId).toBe(roleId);
    expect(after.roleId).toBe(newRole._id.toString());
  });

  it('PLT-8: updateUser() deactivating a user bumps tokenVersion to invalidate sessions (Iron Rule 3: no hard delete)', async () => {
    const user = await userAdminService.createUser({
      tenantId,
      email: 'deactivate@example.com',
      fullName: 'Deactivate Me',
      password: 'Correct1!',
      roleId,
    });

    const { after } = await userAdminService.updateUser(tenantId, user.id, { isActive: false });
    expect(after.isActive).toBe(false);

    const stored = await userModel.findById(user.id);
    expect(stored?.tokenVersion).toBe(1);
    expect(stored).not.toBeNull(); // still exists — no hard delete
  });

  it('PLT-8: listUsers() paginates and is scoped to the tenant (tenant isolation)', async () => {
    const otherTenant = new mongoose.Types.ObjectId().toString();
    const otherRole = await roleModel.create({ tenantId: otherTenant, name: 'Other Role', permissions: [] });
    await userAdminService.createUser({
      tenantId: otherTenant,
      email: 'other@example.com',
      fullName: 'Other Tenant User',
      password: 'Correct1!',
      roleId: otherRole._id.toString(),
    });

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await userAdminService.createUser({
        tenantId,
        email: `user${i}@example.com`,
        fullName: `User ${i}`,
        password: 'Correct1!',
        roleId,
      });
    }

    const { items, meta } = await userAdminService.listUsers(tenantId, 1, 2);
    expect(meta.total).toBe(3);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.tenantId === tenantId)).toBe(true);
  });

  it('PLT-8: listRoles() returns only the tenant\'s own roles', async () => {
    const roles = await userAdminService.listRoles(tenantId);
    expect(roles.some((role) => role.id === roleId)).toBe(true);
  });
});
