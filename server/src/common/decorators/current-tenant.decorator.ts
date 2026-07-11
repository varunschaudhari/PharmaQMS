import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@pharmaqms/shared';

interface RequestWithUser {
  user: AuthenticatedUser;
}

// PLT-1 / Iron Rule 5: tenantId is always read from the authenticated context, never from
// request params or body.
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  return request.user.tenantId;
});
