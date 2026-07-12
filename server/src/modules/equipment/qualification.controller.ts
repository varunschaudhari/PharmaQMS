import { Body, Controller, Get, Param, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createQualificationRecordRequestSchema,
  type CreateQualificationRecordRequest,
} from './dto/equipment.dto';
import { QualificationService, type UploadedQualificationFile } from './qualification.service';

// EQP-8: qualification records (IQ/OQ/PQ/REQUALIFICATION). No SignatureGuard here — SPEC's
// one-line EQP-8 requirement never mentions an e-signature (unlike EQP-4/EQP-9), so this is a
// plain permission-gated action (equipment:edit), same as calibration recording.
@Controller('equipment')
export class QualificationController {
  constructor(private readonly qualificationService: QualificationService) {}

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'protocol', maxCount: 1 }, { name: 'report', maxCount: 1 }]))
  @Post(':id/qualification-records')
  async record(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createQualificationRecordRequestSchema)) dto: CreateQualificationRecordRequest,
    @UploadedFiles() files: { protocol?: UploadedQualificationFile[]; report?: UploadedQualificationFile[] },
  ) {
    const data = await this.qualificationService.recordQualification(
      tenantId,
      id,
      { userId: user.userId, fullName: user.fullName },
      dto,
      files.protocol?.[0] as UploadedQualificationFile,
      files.report?.[0] ?? null,
    );
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'report', maxCount: 1 }]))
  @Post(':id/qualification-records/:recordId/report')
  async attachReport(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @UploadedFiles() files: { report?: UploadedQualificationFile[] },
  ) {
    const data = await this.qualificationService.attachReport(
      tenantId,
      id,
      recordId,
      { userId: user.userId, fullName: user.fullName },
      files.report?.[0] as UploadedQualificationFile,
    );
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/qualification-records')
  async list(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.qualificationService.listForEquipment(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/qualification-records/:recordId/protocol')
  async protocolFile(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.qualificationService.getFile(tenantId, id, recordId, 'protocol');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(file.buffer);
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/qualification-records/:recordId/report')
  async reportFile(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.qualificationService.getFile(tenantId, id, recordId, 'report');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(file.buffer);
  }
}
