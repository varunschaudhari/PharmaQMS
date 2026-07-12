import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ALL_PERMISSION_KEYS, ErrorCode, type CreateTenantRequest, type TenantData } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { AuthService } from '../auth/auth.service';
import { Role, RoleDocument } from '../auth/schemas/role.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { Tenant, TenantDocument } from './schemas/tenant.schema';

export interface UpdateTenantSettingsInput {
  timezone?: string;
  signatureCredentialType?: string;
  accessTokenTtlMinutes?: number;
  refreshTokenTtlHoursDefault?: number;
  refreshTokenTtlDaysRemembered?: number;
  notificationEmailMode?: string;
  trainingGracePeriodDays?: number;
  blockUsageWhenCalibrationOverdue?: boolean;
  maintenanceRoleId?: string | null;
  requireMaintenanceVerification?: boolean;
}

@Injectable()
export class TenantService {
  constructor(
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  // PLT-8: tenant provisioning always creates the tenant's first ("Tenant Admin", full
  // permission matrix) role and user in the same call — a freshly provisioned tenant otherwise
  // has no way to log in and create its own users. Platform-admin only (see PlatformAdminGuard).
  async provisionTenant(dto: CreateTenantRequest): Promise<TenantData> {
    const existing = await this.tenantModel.findOne({ slug: dto.slug });
    if (existing) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, `Tenant slug "${dto.slug}" is already in use.`, HttpStatus.BAD_REQUEST);
    }

    const tenant = await this.tenantModel.create({
      name: dto.name,
      slug: dto.slug,
      settings: dto.settings ?? {},
    });

    const adminRole = await this.roleModel.create({
      tenantId: tenant._id,
      name: 'Tenant Admin',
      permissions: ALL_PERMISSION_KEYS,
    });

    const passwordHash = await AuthService.hashPassword(dto.initialAdmin.password);
    await this.userModel.create({
      tenantId: tenant._id,
      email: dto.initialAdmin.email.toLowerCase(),
      fullName: dto.initialAdmin.fullName,
      passwordHash,
      roleId: adminRole._id,
    });

    return toTenantData(tenant);
  }

  async listTenants(): Promise<TenantData[]> {
    const docs = await this.tenantModel.find().sort({ name: 1 }).lean();
    return docs.map(toTenantData);
  }

  async findById(tenantId: string): Promise<TenantData> {
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Tenant not found.', HttpStatus.NOT_FOUND);
    }
    return toTenantData(tenant);
  }

  async updateSettings(
    tenantId: string,
    settings: UpdateTenantSettingsInput,
  ): Promise<{ before: Record<string, unknown>; after: TenantData }> {
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Tenant not found.', HttpStatus.NOT_FOUND);
    }
    const before: Record<string, unknown> = {
      timezone: tenant.settings.timezone,
      signatureCredentialType: tenant.settings.signatureCredentialType,
      accessTokenTtlMinutes: tenant.settings.accessTokenTtlMinutes,
      refreshTokenTtlHoursDefault: tenant.settings.refreshTokenTtlHoursDefault,
      refreshTokenTtlDaysRemembered: tenant.settings.refreshTokenTtlDaysRemembered,
      notificationEmailMode: tenant.settings.notificationEmailMode,
      trainingGracePeriodDays: tenant.settings.trainingGracePeriodDays,
      blockUsageWhenCalibrationOverdue: tenant.settings.blockUsageWhenCalibrationOverdue,
      maintenanceRoleId: tenant.settings.maintenanceRoleId,
      requireMaintenanceVerification: tenant.settings.requireMaintenanceVerification,
    };

    Object.assign(tenant.settings, settings);
    await tenant.save();

    return { before, after: toTenantData(tenant) };
  }
}

function toTenantData(doc: {
  _id: unknown;
  name: string;
  slug: string;
  settings: {
    timezone: string;
    signatureCredentialType: string;
    accessTokenTtlMinutes: number;
    refreshTokenTtlHoursDefault: number;
    refreshTokenTtlDaysRemembered: number;
    notificationEmailMode: string;
    trainingGracePeriodDays: number;
    blockUsageWhenCalibrationOverdue: boolean;
    maintenanceRoleId: string | null;
    requireMaintenanceVerification: boolean;
  };
  isActive: boolean;
}): TenantData {
  return {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    settings: {
      timezone: doc.settings.timezone,
      signatureCredentialType: doc.settings.signatureCredentialType as TenantData['settings']['signatureCredentialType'],
      accessTokenTtlMinutes: doc.settings.accessTokenTtlMinutes,
      refreshTokenTtlHoursDefault: doc.settings.refreshTokenTtlHoursDefault,
      refreshTokenTtlDaysRemembered: doc.settings.refreshTokenTtlDaysRemembered,
      notificationEmailMode: doc.settings.notificationEmailMode as TenantData['settings']['notificationEmailMode'],
      trainingGracePeriodDays: doc.settings.trainingGracePeriodDays,
      blockUsageWhenCalibrationOverdue: doc.settings.blockUsageWhenCalibrationOverdue,
      maintenanceRoleId: doc.settings.maintenanceRoleId,
      requireMaintenanceVerification: doc.settings.requireMaintenanceVerification,
    },
    isActive: doc.isActive,
  };
}
