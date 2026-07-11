import { ExecutionContext } from '@nestjs/common';
import { ErrorCode, type AuthenticatedUser } from '@pharmaqms/shared';
import { AppException } from '../exceptions/app.exception';
import { SignatureGuard } from './signature.guard';

function buildContext(request: { user?: AuthenticatedUser; body?: { signingToken?: string } }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildUser(userId: string): AuthenticatedUser {
  return {
    userId,
    tenantId: 'tenant-1',
    roleId: 'role-1',
    email: 'user@example.com',
    fullName: 'Test User',
    permissions: [],
    isPlatformAdmin: false,
  };
}

// PLT-3: this is a thin HTTP-layer adapter now — the actual verify/consume/single-use logic is
// tested directly on EsignService (see esign.service.spec.ts), since it's also called in-process
// by WorkflowService (PLT-4) without going through this guard at all.
describe('PLT-3 SignatureGuard', () => {
  it('PLT-3: rejects when no signingToken is presented (session-only signing rejected)', async () => {
    const verifyAndConsumeSigningToken = jest.fn();
    const guard = new SignatureGuard({ verifyAndConsumeSigningToken } as never);

    const context = buildContext({ user: buildUser('user-1'), body: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(AppException);
    expect(verifyAndConsumeSigningToken).not.toHaveBeenCalled();
  });

  it('PLT-3: delegates to EsignService and attaches the signing context on success', async () => {
    const signingContext = { userId: 'user-1', tenantId: 'tenant-1', fullName: 'Test User' };
    const verifyAndConsumeSigningToken = jest.fn().mockResolvedValue(signingContext);
    const guard = new SignatureGuard({ verifyAndConsumeSigningToken } as never);

    const request = { user: buildUser('user-1'), body: { signingToken: 'a-signing-token' } } as {
      user: AuthenticatedUser;
      body: { signingToken: string };
      signingContext?: unknown;
    };
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAndConsumeSigningToken).toHaveBeenCalledWith('a-signing-token', 'user-1');
    expect(request.signingContext).toEqual(signingContext);
  });

  it('PLT-3: propagates rejection from EsignService (e.g. invalid, expired, or reused token)', async () => {
    const verifyAndConsumeSigningToken = jest
      .fn()
      .mockRejectedValue(new AppException(ErrorCode.UNAUTHENTICATED, 'This signing token has already been used.', 401));
    const guard = new SignatureGuard({ verifyAndConsumeSigningToken } as never);

    const context = buildContext({ user: buildUser('user-1'), body: { signingToken: 'reused-token' } });
    await expect(guard.canActivate(context)).rejects.toThrow(AppException);
  });
});
