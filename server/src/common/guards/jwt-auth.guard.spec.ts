import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload } from '@pharmaqms/shared';
import { Public } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import { JwtAuthGuard } from './jwt-auth.guard';

const ACCESS_SECRET = 'test-access-secret';

class DummyController {
  @Public()
  publicMethod(): void {
    /* no-op */
  }

  protectedMethod(): void {
    /* no-op */
  }
}

function buildContext(
  handler: () => void,
  request: { headers: Record<string, string>; user?: unknown },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PLT-1 JwtAuthGuard', () => {
  const jwtService = new JwtService();
  const configService = {
    get: (key: string) => (key === 'auth.jwt.accessSecret' ? ACCESS_SECRET : undefined),
  } as ConfigService;
  const guard = new JwtAuthGuard(new Reflector(), jwtService, configService);

  it('PLT-1: JwtAuthGuard allows public routes through without a token', () => {
    const request: { headers: Record<string, string>; user?: unknown } = { headers: {} };
    const context = buildContext(DummyController.prototype.publicMethod, request);
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('PLT-1: JwtAuthGuard rejects requests without a bearer token', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, { headers: {} });
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('PLT-1: JwtAuthGuard rejects an invalid or expired token', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('PLT-1: JwtAuthGuard attaches the decoded user to the request for a valid access token', () => {
    const payload: AccessTokenPayload = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      roleId: 'role-1',
      email: 'user@example.com',
      fullName: 'Test User',
      permissions: ['admin:admin'],
      isPlatformAdmin: false,
      type: 'access',
    };
    const token = jwtService.sign(payload, { secret: ACCESS_SECRET, expiresIn: '15m' });
    const request = { headers: { authorization: `Bearer ${token}` }, user: undefined as unknown };

    const context = buildContext(DummyController.prototype.protectedMethod, request);
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'user@example.com',
      permissions: ['admin:admin'],
      isPlatformAdmin: false,
    });
  });
});
