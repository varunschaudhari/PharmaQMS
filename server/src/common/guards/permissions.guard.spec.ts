import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { AppException } from '../exceptions/app.exception';
import { PermissionsGuard } from './permissions.guard';

class DummyController {
  @RequirePermission(PermissionModule.ADMIN, PermissionAction.ADMIN)
  protectedMethod(): void {
    /* no-op */
  }

  unprotectedMethod(): void {
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

function buildUser(permissions: string[]): AuthenticatedUser {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    roleId: 'role-1',
    email: 'user@example.com',
    fullName: 'Test User',
    permissions: permissions as AuthenticatedUser['permissions'],
    isPlatformAdmin: false,
  };
}

describe('PLT-1 PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('PLT-1: PermissionsGuard denies access when the user lacks the required permission', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, buildUser([]));
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('PLT-1: PermissionsGuard denies access when there is no authenticated user', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, undefined);
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('PLT-1: PermissionsGuard allows access when the user has the required permission', () => {
    const context = buildContext(DummyController.prototype.protectedMethod, buildUser(['admin:admin']));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('PLT-1: PermissionsGuard allows access when the route requires no permission', () => {
    const context = buildContext(DummyController.prototype.unprotectedMethod, buildUser([]));
    expect(guard.canActivate(context)).toBe(true);
  });
});
