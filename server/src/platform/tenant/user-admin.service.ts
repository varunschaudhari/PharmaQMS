import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  ErrorCode,
  buildPasswordComplexitySchema,
  type PaginationMeta,
  type RoleSummary,
  type UserAdminData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { AuthService } from '../auth/auth.service';
import { authConfig } from '../auth/config/auth.config';
import { Role, RoleDocument } from '../auth/schemas/role.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';

export interface CreateUserInput {
  tenantId: string;
  email: string;
  fullName: string;
  password: string;
  roleId: string;
  departmentId?: string;
}

export interface UpdateUserInput {
  fullName?: string;
  roleId?: string;
  departmentId?: string | null;
  isActive?: boolean;
}

@Injectable()
export class UserAdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async createUser(input: CreateUserInput): Promise<UserAdminData> {
    const role = await this.roleModel.findOne({ _id: input.roleId, tenantId: input.tenantId });
    if (!role) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Role not found.', HttpStatus.NOT_FOUND);
    }

    const existing = await this.userModel.findOne({ tenantId: input.tenantId, email: input.email.toLowerCase() });
    if (existing) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'A user with that email already exists.', HttpStatus.BAD_REQUEST);
    }

    const complexity = buildPasswordComplexitySchema(this.config.passwordPolicy).safeParse(input.password);
    if (!complexity.success) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        complexity.error.issues.map((issue) => issue.message).join('; '),
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await AuthService.hashPassword(input.password);
    const doc = await this.userModel.create({
      tenantId: input.tenantId,
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      passwordHash,
      roleId: input.roleId,
      departmentId: input.departmentId ?? null,
    });
    return toUserAdminData(doc);
  }

  async updateUser(
    tenantId: string,
    userId: string,
    input: UpdateUserInput,
  ): Promise<{ before: Record<string, unknown>; after: UserAdminData }> {
    const user = await this.userModel.findOne({ _id: userId, tenantId });
    if (!user) {
      throw new AppException(ErrorCode.NOT_FOUND, 'User not found.', HttpStatus.NOT_FOUND);
    }
    const before = userSnapshot(user);

    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.roleId !== undefined) {
      const role = await this.roleModel.findOne({ _id: input.roleId, tenantId });
      if (!role) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Role not found.', HttpStatus.NOT_FOUND);
      }
      user.roleId = role._id;
    }
    if (input.departmentId !== undefined) {
      user.departmentId = input.departmentId as unknown as UserDocument['departmentId'];
    }
    // Iron Rule 3: no hard delete — deactivating a user is via isActive, never removal.
    if (input.isActive !== undefined) {
      user.isActive = input.isActive;
      if (!input.isActive) {
        // Deactivating a user must also invalidate any outstanding refresh tokens.
        user.tokenVersion += 1;
      }
    }
    await user.save();

    return { before, after: toUserAdminData(user) };
  }

  async listUsers(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{ items: UserAdminData[]; meta: PaginationMeta }> {
    const filter = { tenantId };
    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ fullName: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);
    return { items: docs.map(toUserAdminData), meta: { page, limit, total } };
  }

  async listRoles(tenantId: string): Promise<RoleSummary[]> {
    const docs = await this.roleModel.find({ tenantId }).sort({ name: 1 }).lean();
    return docs.map((doc) => ({ id: String(doc._id), name: doc.name }));
  }
}

function userSnapshot(user: UserDocument): Record<string, unknown> {
  return {
    fullName: user.fullName,
    roleId: user.roleId.toString(),
    departmentId: user.departmentId ? user.departmentId.toString() : null,
    isActive: user.isActive,
  };
}

function toUserAdminData(doc: {
  _id: unknown;
  tenantId: unknown;
  email: string;
  fullName: string;
  roleId: unknown;
  departmentId: unknown;
  isActive: boolean;
  isPlatformAdmin: boolean;
}): UserAdminData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    email: doc.email,
    fullName: doc.fullName,
    roleId: String(doc.roleId),
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    isActive: doc.isActive,
    isPlatformAdmin: doc.isPlatformAdmin,
  };
}
