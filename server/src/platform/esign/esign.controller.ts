import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentSigningContext, SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@pharmaqms/shared';
import {
  createSignatureRequestSchema,
  signatureChallengeRequestSchema,
  type CreateSignatureRequest,
  type SignatureChallengeRequest,
} from './dto/esign.dto';
import { EsignService } from './esign.service';

@Controller('esign')
export class EsignController {
  constructor(private readonly esignService: EsignService) {}

  // PLT-3 / Iron Rule 4: requires a valid session (global JwtAuthGuard) AND re-verifies the
  // credential right now — the session alone never grants a signing token.
  @HttpCode(HttpStatus.OK)
  @Post('challenge')
  async challenge(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(signatureChallengeRequestSchema)) dto: SignatureChallengeRequest,
  ) {
    const data = await this.esignService.challenge(user.userId, user.tenantId, user.fullName, dto.credential);
    return { data };
  }

  // SignatureGuard consumes the single-use signingToken and attaches signingContext — the
  // identity that actually signs is the one embedded in that token, not just @CurrentUser().
  @UseGuards(SignatureGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('signatures')
  async createSignature(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSigningContext() signingContext: SigningContext,
    @Body(new ZodValidationPipe(createSignatureRequestSchema)) dto: CreateSignatureRequest,
  ) {
    const data = await this.esignService.createSignature({
      tenantId: user.tenantId,
      userId: signingContext.userId,
      userFullName: signingContext.fullName,
      meaning: dto.meaning,
      entityType: dto.entityType,
      entityId: dto.entityId,
      entitySnapshot: dto.entitySnapshot,
      reason: dto.reason,
    });
    return { data };
  }

  // No extra @RequirePermission() beyond authentication (already enforced globally) — same
  // rationale as AuditController's history endpoint: a caller can only have an entityId to ask
  // about if they reached it through that module's own view-gated endpoint in the first place,
  // and the tenant-scoped query never returns another tenant's signatures for the same entityId.
  @Get(':entityType/:entityId/signatures')
  async listSignatures(
    @CurrentTenant() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const data = await this.esignService.findForEntity(tenantId, entityType, entityId);
    return { data };
  }
}
