import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type AuthenticatedUser } from '@pharmaqms/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

// PLT-1 / Iron Rule 5: defense-in-depth check that a tenant context was actually established
// by JwtAuthGuard before any tenant-scoped handler runs.
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user?.tenantId) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Tenant context missing.', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
