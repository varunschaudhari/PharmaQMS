import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@pharmaqms/shared';

interface RequestWithUser {
  user: AuthenticatedUser;
}

// PLT-1: extracts the identity JwtAuthGuard attached to the request.
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
