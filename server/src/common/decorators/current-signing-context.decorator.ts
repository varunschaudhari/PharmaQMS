import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface SigningContext {
  userId: string;
  tenantId: string;
  fullName: string;
}

interface RequestWithSigningContext {
  signingContext: SigningContext;
}

// PLT-3: extracts the identity SignatureGuard attached after verifying+consuming a signing token.
export const CurrentSigningContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SigningContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithSigningContext>();
    return request.signingContext;
  },
);
