import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type AuthenticatedUser } from '@pharmaqms/shared';
import { EsignService } from '../../platform/esign/esign.service';
import { SigningContext } from '../decorators/current-signing-context.decorator';
import { AppException } from '../exceptions/app.exception';

interface SigningRequest {
  user?: AuthenticatedUser;
  body?: { signingToken?: string };
  signingContext?: SigningContext;
}

// PLT-3 / Iron Rule 4: an e-signature always requires a FRESH credential challenge — a valid
// session (the global JwtAuthGuard already checked that) is never sufficient on its own. This is
// a thin HTTP-layer adapter; the actual verify+consume logic lives on EsignService so it can also
// be reused in-process by WorkflowService's approve action (PLT-4).
@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(private readonly esignService: EsignService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SigningRequest>();
    const signingToken = request.body?.signingToken;
    if (!signingToken) {
      throw new AppException(
        ErrorCode.UNAUTHENTICATED,
        'A signing token is required for this action — a valid session alone is not sufficient.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    request.signingContext = await this.esignService.verifyAndConsumeSigningToken(
      signingToken,
      request.user?.userId,
    );
    return true;
  }
}
