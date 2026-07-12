import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import {
  CurrentSigningContext,
  type SigningContext,
} from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createCalibrationScheduleRequestSchema,
  dispositionCalibrationRequestSchema,
  recordCalibrationResultRequestSchema,
  verifyCalibrationRequestSchema,
  type CreateCalibrationScheduleRequest,
  type DispositionCalibrationRequest,
  type RecordCalibrationResultRequest,
} from './dto/equipment.dto';
import { CalibrationService, type UploadedCertificateFile } from './calibration.service';

// EQP-4/EQP-5: calibration schedule/record management, nested under the equipment resource.
// Scheduling + recording a result are engineering/maintenance actions (equipment:edit); QA
// verify/disposition sign-offs require equipment:approve, matching the status card's own
// action-visibility gating (EquipmentService.getStatusCard).
@Controller('equipment')
export class CalibrationController {
  constructor(private readonly calibrationService: CalibrationService) {}

  // EQP-4: QA-facing calibration-due dashboard. Registered ahead of the `:id/...` routes below —
  // 'calibration' has two path segments here ('calibration', 'due') so it can never be captured
  // by EquipmentController's single-segment `GET /equipment/:id`.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('calibration/due')
  async listDue(@CurrentTenant() tenantId: string) {
    const data = await this.calibrationService.listDue(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Post(':id/calibration-schedule')
  async upsertSchedule(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCalibrationScheduleRequestSchema)) dto: CreateCalibrationScheduleRequest,
  ) {
    const { after } = await this.calibrationService.upsertSchedule(
      tenantId,
      id,
      { userId: user.userId, fullName: user.fullName },
      dto,
    );
    return { data: after };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/calibration-schedule')
  async getSchedule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.calibrationService.getSchedule(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/calibration-records')
  async listRecords(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.calibrationService.listRecords(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/calibration-records')
  async recordResult(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordCalibrationResultRequestSchema)) dto: RecordCalibrationResultRequest,
    @UploadedFile() file: UploadedCertificateFile,
  ) {
    const data = await this.calibrationService.recordResult(
      tenantId,
      id,
      { userId: user.userId, fullName: user.fullName },
      dto.performedDate,
      dto.result,
      dto.toleranceNotes ?? null,
      dto.impactAssessmentNote ?? null,
      file,
    );
    return { data };
  }

  // EQP-4 / Iron Rule 4: verifying IS an e-signature — SignatureGuard enforces a fresh credential.
  // Unlike PLT-4's workflow act (whose authorization comes from per-step assignee eligibility),
  // calibration verify/disposition are role-based QA actions, so equipment:approve gates them.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post(':id/calibration-records/:recordId/verify')
  async verify(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(verifyCalibrationRequestSchema)) _dto: unknown,
  ) {
    const data = await this.calibrationService.verify(tenantId, id, recordId, signer);
    return { data };
  }

  // EQP-5 / Iron Rule 4: dispositioning an OOT result IS an e-signature.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post(':id/calibration-records/:recordId/disposition')
  async disposition(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(dispositionCalibrationRequestSchema)) dto: DispositionCalibrationRequest,
  ) {
    const data = await this.calibrationService.disposition(tenantId, id, recordId, signer, dto);
    return { data };
  }
}
