import { Body, Controller, Get, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ErrorCode, PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import type { Response } from 'express';
import {
  CurrentSigningContext,
  type SigningContext,
} from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  completeTrainingAssignmentRequestSchema,
  type CompleteTrainingAssignmentRequest,
} from './dto/training.dto';
import { TrainingService } from './training.service';

const TRAINING_VIEW_PERMISSION = `${PermissionModule.TRAINING}:${PermissionAction.VIEW}`;

// TRN-1..TRN-5: my-assignments/complete need only authentication (every employee has training);
// the matrix/overdue dashboard and other employees' records require training:view.
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get('my-assignments')
  async myAssignments(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.trainingService.listForUser(tenantId, user.userId);
    return { data };
  }

  // TRN-2: read-and-understood — SignatureGuard enforces a fresh credential (Iron Rule 4); the
  // service itself writes the audit event (same pattern as DOC-7 obsolescence), so no @Audited().
  @UseGuards(SignatureGuard)
  @Post('assignments/:id/complete')
  async complete(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeTrainingAssignmentRequestSchema)) _dto: CompleteTrainingAssignmentRequest,
  ) {
    const data = await this.trainingService.completeAssignment(tenantId, signer, id);
    return { data };
  }

  @RequirePermission(PermissionModule.TRAINING, PermissionAction.VIEW)
  @Get('matrix')
  async matrix(@CurrentTenant() tenantId: string) {
    const data = await this.trainingService.getMatrix(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.TRAINING, PermissionAction.VIEW)
  @Get('overdue')
  async overdue(@CurrentTenant() tenantId: string) {
    const data = await this.trainingService.listOverdue(tenantId);
    return { data };
  }

  // TRN-4: any employee may pull their OWN record without training:view; pulling someone
  // else's requires it (same "own resource or explicit permission" pattern as PLT-6 notifications).
  @Get('employees/:userId/record')
  async employeeRecord(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    this.assertCanViewRecord(user, userId);
    const data = await this.trainingService.listForUser(tenantId, userId);
    return { data };
  }

  @Get('employees/:userId/record.pdf')
  async employeeRecordPdf(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.assertCanViewRecord(user, userId);
    const pdf = await this.trainingService.generateEmployeeRecordPdf(tenantId, userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="training-record-${userId}.pdf"`);
    res.send(pdf);
  }

  private assertCanViewRecord(user: AuthenticatedUser, targetUserId: string): void {
    if (user.userId === targetUserId) {
      return;
    }
    if (!user.permissions.includes(TRAINING_VIEW_PERMISSION)) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You do not have permission to view this training record.',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
