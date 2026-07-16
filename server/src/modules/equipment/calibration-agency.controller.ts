import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CalibrationAgencyService, type UploadedAccreditationCertificateFile } from './calibration-agency.service';
import {
  createCalibrationAgencyRequestSchema,
  listCalibrationCertificatesQuerySchema,
  transitionCalibrationAgencyStatusRequestSchema,
  updateCalibrationAgencyRequestSchema,
  type CreateCalibrationAgencyRequest,
  type ListCalibrationCertificatesQuery,
  type TransitionCalibrationAgencyStatusRequest,
  type UpdateCalibrationAgencyRequest,
} from './dto/equipment.dto';

// EQP-11 (SPEC.md §7.3): external calibration agency master, agency-wise due list, and the
// certificate registry — all equipment:view/edit gated, same permission split calibration
// scheduling/recording already uses (no signature — nothing here is being attested).
@Controller('equipment/calibration-agencies')
export class CalibrationAgencyController {
  constructor(private readonly agencyService: CalibrationAgencyService) {}

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Post()
  async create(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createCalibrationAgencyRequestSchema)) dto: CreateCalibrationAgencyRequest) {
    const data = await this.agencyService.create(tenantId, dto, { userId: user.userId, fullName: user.fullName });
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get()
  async list(@CurrentTenant() tenantId: string) {
    const data = await this.agencyService.list(tenantId);
    return { data };
  }

  // EQP-11 (c): agency-wise due list — registered ahead of `:id` below (multi-segment literal
  // paths, same route-ordering convention as CalibrationController's own 'calibration/due').
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('due')
  async listDue(@CurrentTenant() tenantId: string) {
    const data = await this.agencyService.listDueByAgency(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('due.csv')
  async exportDueCsv(@CurrentTenant() tenantId: string, @Res() res: Response): Promise<void> {
    const csv = await this.agencyService.exportDueByAgencyCsv(tenantId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="calibration-due-by-agency.csv"');
    res.send(csv);
  }

  // EQP-11 (c): the session brief called for the agency-wise due list "exportable to PDF/CSV" —
  // this is the PDF half, alongside due.csv above.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('due.pdf')
  async exportDuePdf(@CurrentTenant() tenantId: string, @Res() res: Response): Promise<void> {
    const pdf = await this.agencyService.generateDueByAgencyPdf(tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="calibration-due-by-agency.pdf"');
    res.send(pdf);
  }

  // EQP-11 (e): certificate registry — filterable by agency/equipment/date.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('certificates')
  async listCertificates(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listCalibrationCertificatesQuerySchema)) query: ListCalibrationCertificatesQuery) {
    const data = await this.agencyService.listCertificates(tenantId, query);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.agencyService.get(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Patch(':id')
  async update(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(updateCalibrationAgencyRequestSchema)) dto: UpdateCalibrationAgencyRequest) {
    const { after } = await this.agencyService.update(tenantId, id, dto, { userId: user.userId, fullName: user.fullName });
    return { data: after };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Post(':id/status')
  async transitionStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionCalibrationAgencyStatusRequestSchema)) dto: TransitionCalibrationAgencyStatusRequest,
  ) {
    const { after } = await this.agencyService.transitionStatus(tenantId, id, dto.status, { userId: user.userId, fullName: user.fullName });
    return { data: after };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/certificates')
  async uploadCertificate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedAccreditationCertificateFile,
  ) {
    const data = await this.agencyService.uploadCertificate(tenantId, id, { userId: user.userId, fullName: user.fullName }, file);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/certificates/:certificateId')
  async downloadCertificate(@CurrentTenant() tenantId: string, @Param('id') id: string, @Param('certificateId') certificateId: string, @Res() res: Response): Promise<void> {
    const file = await this.agencyService.getCertificateFile(tenantId, id, certificateId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(file.buffer);
  }
}
