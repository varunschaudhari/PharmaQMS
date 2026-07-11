import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  buildPasswordComplexitySchema,
  type AccessTokenPayload,
  type AuthTokens,
  type AuthenticatedUser,
  type LoginRequest,
  type LoginResponseData,
  type RefreshRequest,
  type RefreshTokenPayload,
} from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import type { AuditPayload } from '../../common/decorators/audited.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { Tenant, TenantDocument } from '../tenant/schemas/tenant.schema';
import { resolveJwtTtlSettings } from '../tenant/tenant-settings.util';
import { authConfig } from './config/auth.config';
import { isPasswordExpired } from './password-policy.util';
import { Role, RoleDocument } from './schemas/role.schema';
import { User, UserDocument } from './schemas/user.schema';

const BCRYPT_SALT_ROUNDS = 10;

interface LockoutSnapshot {
  failedLoginAttempts: number;
  lockedUntil: string | null;
  [key: string]: unknown;
}

export interface ChangePasswordResult {
  audit: AuditPayload;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async login(dto: LoginRequest): Promise<LoginResponseData> {
    // PLT-1: tenantId comes from the request body only at this unauthenticated boundary —
    // there is no prior session to derive it from (see schemas/auth.ts comment).
    const user = await this.userModel
      .findOne({ tenantId: dto.tenantId, email: dto.email.toLowerCase() })
      .select('+passwordHash');

    if (!user) {
      // Do not reveal whether the email exists — and there is no entity to attach an audit
      // event to, so none is written for this case.
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid email or password.', HttpStatus.UNAUTHORIZED);
    }

    // PLT-2: login/lockout events are audited via direct AuditService calls, not the
    // @Audited()/AuditTrailInterceptor pattern — that pattern derives actor/tenant from an
    // authenticated request context, which doesn't exist yet at this pre-auth boundary, and a
    // success-only interceptor can't observe these failure-path branches anyway.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.auditLoginOutcome(user, AuditAction.LOGIN_FAILURE, 'Login rejected: account is locked.');
      throw new AppException(
        ErrorCode.AUTH_ACCOUNT_LOCKED,
        `Account is locked until ${user.lockedUntil.toISOString()}.`,
        HttpStatus.FORBIDDEN,
      );
    }

    if (!user.isActive) {
      throw new AppException(ErrorCode.AUTH_ACCOUNT_INACTIVE, 'Account is inactive.', HttpStatus.UNAUTHORIZED);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      const before = this.lockoutSnapshot(user);
      await this.registerFailedAttempt(user);
      const after = this.lockoutSnapshot(user);
      const justLocked = after.lockedUntil !== null && before.lockedUntil === null;
      await this.auditService.record({
        tenantId: user.tenantId.toString(),
        actor: { userId: user._id.toString(), fullName: user.fullName },
        entityType: 'User',
        entityId: user._id.toString(),
        action: justLocked ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILURE,
        before,
        after,
        reason: justLocked
          ? `Account locked after ${this.config.lockout.maxAttempts} consecutive failed login attempts.`
          : 'Invalid password.',
      });
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid email or password.', HttpStatus.UNAUTHORIZED);
    }

    const before = this.lockoutSnapshot(user);
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();
    const after = this.lockoutSnapshot(user);
    await this.auditLoginOutcome(user, AuditAction.LOGIN_SUCCESS, null, before, after);

    const role = await this.findRoleOrThrow(user);
    const tokens = await this.issueTokens(user, role, dto.rememberDevice ?? false);
    const mustChangePassword = isPasswordExpired(user.passwordChangedAt, this.config.passwordPolicy.expiryDays);

    return { tokens, user: this.toAuthenticatedUser(user, role), mustChangePassword };
  }

  async refresh(dto: RefreshRequest): Promise<LoginResponseData> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(dto.refreshToken, {
        secret: this.config.jwt.refreshSecret,
      });
      if (payload.type !== 'refresh') {
        throw new Error('Not a refresh token');
      }
    } catch {
      throw new AppException(
        ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Invalid or expired refresh token.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.userModel.findOne({ _id: payload.sub, tenantId: payload.tenantId });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      // Already rotated (reused refresh token) or the user no longer exists.
      throw new AppException(
        ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
        'Refresh token has already been used or revoked.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.assertNotLocked(user);

    const role = await this.findRoleOrThrow(user);

    // Refresh rotation: bump tokenVersion so the presented refresh token can never be reused.
    user.tokenVersion += 1;
    await user.save();

    const tokens = await this.issueTokens(user, role, payload.remembered);
    const mustChangePassword = isPasswordExpired(user.passwordChangedAt, this.config.passwordPolicy.expiryDays);

    return { tokens, user: this.toAuthenticatedUser(user, role), mustChangePassword };
  }

  // PLT-1 (added for PLT-2): re-authenticates with the current password, applies the tenant's
  // live password policy, and bumps tokenVersion so every outstanding session must re-login.
  // Returns an audit payload for the controller to hand to @Audited()/AuditTrailInterceptor —
  // unlike login/lockout, this endpoint runs on an authenticated request, so the standard
  // declarative pattern applies.
  async changePassword(
    userId: string,
    tenantId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResult> {
    const user = await this.userModel.findOne({ _id: userId, tenantId }).select('+passwordHash');
    if (!user) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'User not found.', HttpStatus.UNAUTHORIZED);
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new AppException(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        'Current password is incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const complexity = buildPasswordComplexitySchema(this.config.passwordPolicy).safeParse(newPassword);
    if (!complexity.success) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        complexity.error.issues.map((issue) => issue.message).join('; '),
        HttpStatus.BAD_REQUEST,
      );
    }

    // Deliberately minimal, hand-built snapshots — never diff a raw User document here, so a
    // passwordHash value can never end up in the audit trail (see audit-diff.util's own
    // defense-in-depth ignore-list too).
    const before = { passwordChangedAt: user.passwordChangedAt.toISOString() };
    user.passwordHash = await AuthService.hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    user.tokenVersion += 1;
    await user.save();
    const after = { passwordChangedAt: user.passwordChangedAt.toISOString() };

    return {
      audit: { entityId: user._id.toString(), before, after, reason: null },
    };
  }

  private assertNotLocked(user: UserDocument): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppException(
        ErrorCode.AUTH_ACCOUNT_LOCKED,
        `Account is locked until ${user.lockedUntil.toISOString()}.`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async registerFailedAttempt(user: UserDocument): Promise<void> {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= this.config.lockout.maxAttempts) {
      user.lockedUntil = new Date(Date.now() + this.config.lockout.durationMinutes * 60_000);
      // Invalidate any outstanding refresh tokens once an account is locked.
      user.tokenVersion += 1;
    }
    await user.save();
  }

  private lockoutSnapshot(user: UserDocument): LockoutSnapshot {
    return {
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil ? user.lockedUntil.toISOString() : null,
    };
  }

  private async auditLoginOutcome(
    user: UserDocument,
    action: AuditAction,
    reason: string | null,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      tenantId: user.tenantId.toString(),
      actor: { userId: user._id.toString(), fullName: user.fullName },
      entityType: 'User',
      entityId: user._id.toString(),
      action,
      before,
      after,
      reason,
    });
  }

  private async findRoleOrThrow(user: UserDocument): Promise<RoleDocument> {
    const role = await this.roleModel.findOne({ _id: user.roleId, tenantId: user.tenantId });
    if (!role) {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'User role is not configured.', HttpStatus.FORBIDDEN);
    }
    return role;
  }

  private async issueTokens(user: UserDocument, role: RoleDocument, remembered: boolean): Promise<AuthTokens> {
    // PLT-8: session-timeout (JWT TTL) settings are tenant-configurable; falls back to the
    // platform defaults when the tenant has no document yet (e.g. not-yet-provisioned tenants
    // used in tests that predate PLT-8).
    const tenant = await this.tenantModel.findById(user.tenantId);
    const jwtTtl = resolveJwtTtlSettings(tenant, {
      accessTtl: this.config.jwt.accessTtl,
      refreshTtlDefault: this.config.jwt.refreshTtlDefault,
      refreshTtlRemembered: this.config.jwt.refreshTtlRemembered,
    });

    const accessPayload: AccessTokenPayload = {
      sub: user._id.toString(),
      tenantId: user.tenantId.toString(),
      roleId: role._id.toString(),
      email: user.email,
      fullName: user.fullName,
      permissions: role.permissions,
      isPlatformAdmin: user.isPlatformAdmin,
      type: 'access',
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user._id.toString(),
      tenantId: user.tenantId.toString(),
      tokenVersion: user.tokenVersion,
      remembered,
      type: 'refresh',
    };
    const refreshTtl = remembered ? jwtTtl.refreshTtlRemembered : jwtTtl.refreshTtlDefault;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.jwt.accessSecret,
        expiresIn: jwtTtl.accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, { secret: this.config.jwt.refreshSecret, expiresIn: refreshTtl }),
    ]);

    return { accessToken, refreshToken };
  }

  private toAuthenticatedUser(user: UserDocument, role: RoleDocument): AuthenticatedUser {
    return {
      userId: user._id.toString(),
      tenantId: user.tenantId.toString(),
      roleId: role._id.toString(),
      email: user.email,
      fullName: user.fullName,
      permissions: role.permissions,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }
}
