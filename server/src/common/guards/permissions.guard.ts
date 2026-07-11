import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type AuthenticatedUser, type PermissionKey } from '@pharmaqms/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { AppException } from '../exceptions/app.exception';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

// PLT-1: enforces the @RequirePermission() permission-matrix check (SPEC.md §5.3).
// Permissions are a snapshot embedded in the access token at issue time — a role change
// takes effect on the user's next token refresh, not mid-session.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user || !user.permissions.includes(requiredPermission)) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
