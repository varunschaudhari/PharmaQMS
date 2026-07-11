import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import {
  CredentialType,
  ErrorCode,
  SignatureMeaning,
  type SignatureChallengeResponse,
  type SignatureData,
  type SigningTokenPayload,
} from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { Tenant, TenantDocument } from '../tenant/schemas/tenant.schema';
import { resolveSignatureCredentialType } from '../tenant/tenant-settings.util';
import { esignConfig } from './config/esign.config';
import { hashEntitySnapshot, verifyEntitySnapshot } from './snapshot-hash.util';
import { Signature, SignatureDocument } from './schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageDocument } from './schemas/signing-token-usage.schema';

export interface CreateSignatureInput {
  tenantId: string;
  userId: string;
  userFullName: string;
  meaning: SignatureMeaning;
  entityType: string;
  entityId: string;
  entitySnapshot: Record<string, unknown>;
  reason?: string | null;
}

@Injectable()
export class EsignService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Signature.name) private readonly signatureModel: Model<SignatureDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(SigningTokenUsage.name) private readonly usageModel: Model<SigningTokenUsageDocument>,
    private readonly jwtService: JwtService,
    @Inject(esignConfig.KEY) private readonly config: ConfigType<typeof esignConfig>,
  ) {}

  // PLT-3 / Iron Rule 4: re-verifies the user's credential right now — a valid session is never
  // sufficient — and mints a short-lived (≤2 min, hard-capped in config), single-use signing token.
  async challenge(userId: string, tenantId: string, fullName: string, credential: string): Promise<SignatureChallengeResponse> {
    // PLT-8: signature credential type ("e-sign mode") is tenant-configurable; falls back to the
    // platform default when the tenant has no document yet.
    const tenant = await this.tenantModel.findById(tenantId);
    const credentialType = resolveSignatureCredentialType(tenant, this.config.credentialType);

    if (credentialType === CredentialType.PIN) {
      // PLT-3: PIN-based signing needs a `pinHash` field on User (PLT-8 territory) and isn't
      // implemented yet. A tenant configured for 'pin' before that lands is a deployment error.
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'PIN-based signing is not yet supported for this tenant.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.userModel.findOne({ _id: userId, tenantId }).select('+passwordHash');
    if (!user) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'User not found.', HttpStatus.UNAUTHORIZED);
    }

    const matches = await bcrypt.compare(credential, user.passwordHash);
    if (!matches) {
      throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Incorrect password.', HttpStatus.UNAUTHORIZED);
    }

    const payload: SigningTokenPayload = {
      sub: userId,
      tenantId,
      fullName,
      jti: randomUUID(),
      type: 'signing',
    };
    const signingToken = await this.jwtService.signAsync(payload, {
      secret: this.config.signingTokenSecret,
      expiresIn: this.config.signingTokenTtlSeconds,
    });

    return {
      signingToken,
      expiresAt: new Date(Date.now() + this.config.signingTokenTtlSeconds * 1000).toISOString(),
    };
  }

  // PLT-3 / Iron Rule 4: verifies a signing token and atomically consumes it (single-use — the
  // unique index on `jti` makes a replay's insert fail even under concurrent requests). Used by
  // SignatureGuard (generic HTTP path, see /esign/signatures) and reused in-process by
  // WorkflowService's approve action — there is no other way to compose PLT-3 into PLT-4, since
  // Signature records are append-only and can never be mutated to mark them "consumed by a
  // workflow" after the fact; the workflow engine must create the signature itself using a fresh
  // single-use token.
  async verifyAndConsumeSigningToken(signingToken: string, expectedUserId?: string): Promise<SigningContext> {
    let payload: SigningTokenPayload;
    try {
      payload = this.jwtService.verify<SigningTokenPayload>(signingToken, {
        secret: this.config.signingTokenSecret,
      });
      if (payload.type !== 'signing') {
        throw new Error('Not a signing token');
      }
    } catch {
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'Invalid or expired signing token.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (expectedUserId && expectedUserId !== payload.sub) {
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'Signing token does not match the authenticated session.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      await this.usageModel.create({ jti: payload.jti, usedAt: new Date() });
    } catch {
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'This signing token has already been used.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { userId: payload.sub, tenantId: payload.tenantId, fullName: payload.fullName };
  }

  async createSignature(input: CreateSignatureInput): Promise<SignatureData> {
    const snapshotHash = hashEntitySnapshot(input.entitySnapshot);
    const doc = await this.signatureModel.create({
      tenantId: input.tenantId,
      userId: input.userId,
      userFullName: input.userFullName,
      meaning: input.meaning,
      entityType: input.entityType,
      entityId: input.entityId,
      snapshotHash,
      reason: input.reason ?? null,
      signedAt: new Date(),
    });
    return toSignatureData(doc);
  }

  async findForEntity(tenantId: string, entityType: string, entityId: string): Promise<SignatureData[]> {
    const docs = await this.signatureModel.find({ tenantId, entityType, entityId }).sort({ signedAt: -1 }).lean();
    return docs.map(toSignatureData);
  }

  // Detects tampering: false whenever `currentSnapshot` no longer matches what was signed —
  // i.e. the signed content was mutated instead of versioned (SPEC.md §5.2 / Iron Rule 4).
  async verifySnapshot(
    tenantId: string,
    signatureId: string,
    currentSnapshot: Record<string, unknown>,
  ): Promise<boolean> {
    const signature = await this.signatureModel.findOne({ _id: signatureId, tenantId });
    if (!signature) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Signature not found.', HttpStatus.NOT_FOUND);
    }
    return verifyEntitySnapshot(currentSnapshot, signature.snapshotHash);
  }
}

function toSignatureData(doc: {
  _id: unknown;
  tenantId: unknown;
  userId: string;
  userFullName: string;
  meaning: SignatureMeaning;
  entityType: string;
  entityId: string;
  snapshotHash: string;
  reason: string | null;
  signedAt: Date;
}): SignatureData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    userId: doc.userId,
    userFullName: doc.userFullName,
    meaning: doc.meaning,
    entityType: doc.entityType,
    entityId: doc.entityId,
    snapshotHash: doc.snapshotHash,
    reason: doc.reason,
    signedAt: doc.signedAt.toISOString(),
  };
}
