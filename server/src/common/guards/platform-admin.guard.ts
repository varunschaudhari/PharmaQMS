import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type AuthenticatedUser } from '@pharmaqms/shared';
import { AppException } from '../exceptions/app.exception';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

// PLT-8: gates tenant provisioning/cross-tenant administration to the platform's own operators
// (SPEC.md §4 "System Admin (Varun/support)") — orthogonal to, and independent of, the
// tenant-scoped permission matrix. JwtAuthGuard (global) has already required a valid session;
// this additionally requires `isPlatformAdmin` on that session's user.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user?.isPlatformAdmin) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'This action requires platform administrator access.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
