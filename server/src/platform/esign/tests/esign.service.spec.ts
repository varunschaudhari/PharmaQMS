import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode, SignatureMeaning, type SigningTokenPayload } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { Tenant, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { esignConfig } from '../config/esign.config';
import { EsignService } from '../esign.service';
import { Signature, SignatureSchema } from '../schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageDocument, SigningTokenUsageSchema } from '../schemas/signing-token-usage.schema';

const SIGNING_SECRET = 'test-signing-secret';

describe('PLT-3 EsignService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let esignService: EsignService;
  let jwtService: JwtService;
  let userModel: Model<UserDocument>;
  let usageModel: Model<SigningTokenUsageDocument>;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    // esignConfig reads JWT_SIGNING_SECRET from the environment — set it before ConfigModule
    // loads, so tokens signed with SIGNING_SECRET below match what the service verifies against.
    process.env.JWT_SIGNING_SECRET = SIGNING_SECRET;
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [esignConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
        ]),
      ],
      providers: [EsignService],
    }).compile();

    esignService = moduleRef.get(EsignService);
    jwtService = moduleRef.get(JwtService);
    userModel = moduleRef.get(getModelToken(User.name));
    usageModel = moduleRef.get(getModelToken(SigningTokenUsage.name));
    // Mongoose builds indexes asynchronously in the background (autoIndex) — without waiting
    // for this, the unique index on `jti` that single-use enforcement relies on might not exist
    // yet when the test's inserts race against it, making the assertion flaky.
    await usageModel.init();

    tenantId = new mongoose.Types.ObjectId().toString();
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    const user = await userModel.create({
      tenantId,
      email: 'qa.head@example.com',
      fullName: 'QA Head',
      passwordHash,
      roleId: new mongoose.Types.ObjectId(),
    });
    userId = user._id.toString();
  });

  function signToken(overrides: Partial<SigningTokenPayload> = {}, secret = SIGNING_SECRET, ttl = 120): string {
    const payload: SigningTokenPayload = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      fullName: 'Test User',
      jti: `jti-${Math.random()}`,
      type: 'signing',
      ...overrides,
    };
    return jwtService.sign(payload, { secret, expiresIn: ttl });
  }

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('PLT-3: challenge() issues a signing token for the correct credential', async () => {
    const result = await esignService.challenge(userId, tenantId, 'QA Head', 'Correct1!');
    expect(result.signingToken).toEqual(expect.any(String));
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('PLT-3: challenge() rejects an incorrect credential', async () => {
    await expect(esignService.challenge(userId, tenantId, 'QA Head', 'wrong-password')).rejects.toThrow(
      AppException,
    );
  });

  it('PLT-3: challenge() caps the signing token TTL at 120 seconds', async () => {
    const before = Date.now();
    const result = await esignService.challenge(userId, tenantId, 'QA Head', 'Correct1!');
    const ttlMs = new Date(result.expiresAt).getTime() - before;
    expect(ttlMs).toBeLessThanOrEqual(120_000 + 2000); // small allowance for test execution time
  });

  it('PLT-3: createSignature() records the meaning, entity ref, and a snapshot hash', async () => {
    const signature = await esignService.createSignature({
      tenantId,
      userId,
      userFullName: 'QA Head',
      meaning: SignatureMeaning.APPROVED_BY,
      entityType: 'Document',
      entityId: 'doc-1',
      entitySnapshot: { title: 'SOP-1', version: 2 },
      reason: 'Final approval',
    });

    expect(signature.meaning).toBe(SignatureMeaning.APPROVED_BY);
    expect(signature.entityType).toBe('Document');
    expect(signature.entityId).toBe('doc-1');
    expect(signature.reason).toBe('Final approval');
    expect(signature.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PLT-3: findForEntity() returns signatures for that entity, newest first', async () => {
    const entityId = 'doc-history';
    await esignService.createSignature({
      tenantId,
      userId,
      userFullName: 'QA Head',
      meaning: SignatureMeaning.REVIEWED_BY,
      entityType: 'Document',
      entityId,
      entitySnapshot: { version: 1 },
    });
    await esignService.createSignature({
      tenantId,
      userId,
      userFullName: 'QA Head',
      meaning: SignatureMeaning.APPROVED_BY,
      entityType: 'Document',
      entityId,
      entitySnapshot: { version: 1 },
    });

    const signatures = await esignService.findForEntity(tenantId, 'Document', entityId);
    expect(signatures).toHaveLength(2);
    expect(signatures[0].meaning).toBe(SignatureMeaning.APPROVED_BY);
    expect(signatures[1].meaning).toBe(SignatureMeaning.REVIEWED_BY);
  });

  it('PLT-3: verifySnapshot() detects a tampered snapshot (hash mismatch)', async () => {
    const signature = await esignService.createSignature({
      tenantId,
      userId,
      userFullName: 'QA Head',
      meaning: SignatureMeaning.QA_DISPOSITION,
      entityType: 'Equipment',
      entityId: 'eqp-1',
      entitySnapshot: { status: 'Calibrated', calibratedOn: '2026-01-01' },
    });

    const matchesOriginal = await esignService.verifySnapshot(tenantId, signature.id, {
      status: 'Calibrated',
      calibratedOn: '2026-01-01',
    });
    expect(matchesOriginal).toBe(true);

    const matchesTampered = await esignService.verifySnapshot(tenantId, signature.id, {
      status: 'Overdue',
      calibratedOn: '2026-01-01',
    });
    expect(matchesTampered).toBe(false);
  });

  it('PLT-3: verifySnapshot() throws NOT_FOUND for an unknown signature id', async () => {
    try {
      await esignService.verifySnapshot(tenantId, new mongoose.Types.ObjectId().toString(), {});
      throw new Error('expected verifySnapshot to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  describe('verifyAndConsumeSigningToken (also reused in-process by PLT-4 WorkflowService)', () => {
    it('PLT-3: rejects an invalid or expired signing token', async () => {
      await expect(esignService.verifyAndConsumeSigningToken('not-a-real-token')).rejects.toThrow(AppException);
    });

    it('PLT-3: rejects a token signed with the wrong secret', async () => {
      const token = signToken({}, 'wrong-secret');
      await expect(esignService.verifyAndConsumeSigningToken(token)).rejects.toThrow(AppException);
    });

    it('PLT-3: rejects a signing token whose user does not match the expected session', async () => {
      const token = signToken({ sub: 'user-1' });
      await expect(esignService.verifyAndConsumeSigningToken(token, 'user-2')).rejects.toThrow(AppException);
    });

    it('PLT-3: resolves the signing context for a valid, unused signing token', async () => {
      const token = signToken({ sub: 'user-1', jti: 'jti-single-use-1' });
      await expect(esignService.verifyAndConsumeSigningToken(token, 'user-1')).resolves.toEqual({
        userId: 'user-1',
        tenantId: 'tenant-1',
        fullName: 'Test User',
      });
    });

    it('PLT-3: rejects reuse of the same signing token (single-use)', async () => {
      const token = signToken({ sub: 'user-1', jti: 'jti-single-use-2' });
      await expect(esignService.verifyAndConsumeSigningToken(token)).resolves.toBeDefined();
      await expect(esignService.verifyAndConsumeSigningToken(token)).rejects.toThrow(AppException);
    });
  });
});
