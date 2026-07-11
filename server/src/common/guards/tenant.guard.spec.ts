import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@pharmaqms/shared';
import { Public } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import { TenantGuard } from './tenant.guard';

class DummyController {
  @Public()
  publicMethod(): void {
    /* no-op */
  }

  protectedMethod(): void {
    /* no-op */
  }
}

function buildContext(handler: () => void, user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PLT-1 TenantGuard', () => {
  const guard = new TenantGuard(new Reflector());

  it('PLT-1: TenantGuard rejects requests with no tenant context', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, undefined);
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('PLT-1: TenantGuard allows requests once a tenant context is established', () => {
    const user: AuthenticatedUser = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roleId: 'role-1',
      email: 'user@example.com',
      fullName: 'Test User',
      permissions: [],
      isPlatformAdmin: false,
    };
    const context = buildContext(DummyController.prototype.protectedMethod, user);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('PLT-1: TenantGuard allows public routes through without tenant context', () => {
    const context = buildContext(DummyController.prototype.publicMethod, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
});
