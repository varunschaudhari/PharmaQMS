import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  submitTrainingAssessmentAttemptRequestSchema,
  upsertTrainingAssessmentRequestSchema,
  type SubmitTrainingAssessmentAttemptRequest,
  type UpsertTrainingAssessmentRequest,
} from './dto/training-assessment.dto';
import { TrainingAssessmentService } from './training-assessment.service';

// TRN-6: QA authors/approves the question bank on `documents/:documentId/versions/:versionId` —
// training:edit/approve gated, same permission split EQP-4/QRX-2 use elsewhere in this codebase.
// The trainee-facing `assignments/:id/assessment*` routes need only authentication (own-assignment
// ownership is asserted inside the service), same as TRN-2's own complete endpoint. Audit events
// are written by the service itself (not the `@Audited()` decorator) since upsert is create-or-
// update and the accurate before/after only the service can compute — same pattern as EQP-4/5's
// SignatureGuard-guarded calibration verify/disposition endpoints.
@Controller('training')
export class TrainingAssessmentController {
  constructor(private readonly assessmentService: TrainingAssessmentService) {}

  @RequirePermission(PermissionModule.TRAINING, PermissionAction.EDIT)
  @Put('documents/:documentId/versions/:versionId/assessment')
  async upsert(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(upsertTrainingAssessmentRequestSchema)) dto: UpsertTrainingAssessmentRequest,
  ) {
    const data = await this.assessmentService.upsertAssessment(tenantId, documentId, versionId, { userId: user.userId, fullName: user.fullName }, dto);
    return { data };
  }

  @RequirePermission(PermissionModule.TRAINING, PermissionAction.APPROVE)
  @Post('documents/:documentId/versions/:versionId/assessment/approve')
  async approve(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    const data = await this.assessmentService.approveAssessment(tenantId, versionId, { userId: user.userId, fullName: user.fullName });
    return { data };
  }

  @RequirePermission(PermissionModule.TRAINING, PermissionAction.VIEW)
  @Get('documents/:documentId/versions/:versionId/assessment')
  async getForAuthoring(@CurrentTenant() tenantId: string, @Param('versionId') versionId: string) {
    const data = await this.assessmentService.getForAuthoring(tenantId, versionId);
    return { data };
  }

  // TRN-6: any authenticated user may fetch their OWN assignment's quiz — ownership is asserted
  // inside the service (mirrors TrainingController.complete's own-assignment check).
  @Get('assignments/:id/assessment')
  async getForTrainee(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.assessmentService.getForTrainee(tenantId, id, user.userId);
    return { data };
  }

  @Post('assignments/:id/assessment/attempts')
  async submitAttempt(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitTrainingAssessmentAttemptRequestSchema)) dto: SubmitTrainingAssessmentAttemptRequest,
  ) {
    const data = await this.assessmentService.submitAttempt(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto);
    return { data };
  }
}
