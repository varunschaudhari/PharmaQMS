import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule } from '@pharmaqms/shared';
import type { Response } from 'express';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createQrCodeRequestSchema,
  qrLabelQuerySchema,
  type CreateQrCodeRequest,
  type QrLabelQuery,
} from './dto/qr.dto';
import { QrService } from './qr.service';

// PLT-7: QR short-code service. Resolution/rendering need only an authenticated session (any
// operator scans labels); minting codes is an admin action (business modules mint their own
// codes in-process via QrService, not through this endpoint).
@Controller('qr')
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: 'QrCode', action: AuditAction.CREATE })
  @Post('codes')
  async create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createQrCodeRequestSchema)) dto: CreateQrCodeRequest,
  ) {
    const { data, created } = await this.qrService.getOrCreateForEntity(tenantId, dto);
    return {
      data,
      // Idempotent re-posts return the existing code without a second audit event.
      ...(created
        ? { audit: { entityId: data.id, before: null, after: data as unknown as Record<string, unknown> } }
        : {}),
    };
  }

  @Get('resolve/:code')
  async resolve(@CurrentTenant() tenantId: string, @Param('code') code: string) {
    const data = await this.qrService.resolve(tenantId, code);
    return { data };
  }

  @Get('codes/:code/png')
  async png(@CurrentTenant() tenantId: string, @Param('code') code: string, @Res() res: Response): Promise<void> {
    const png = await this.qrService.generatePng(tenantId, code);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  @Get('codes/:code/label.pdf')
  async labelPdf(
    @CurrentTenant() tenantId: string,
    @Param('code') code: string,
    @Query(new ZodValidationPipe(qrLabelQuerySchema)) query: QrLabelQuery,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.qrService.generateLabelPdf(tenantId, code, query.size);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="qr-label-${code}-${query.size}.pdf"`);
    res.send(pdf);
  }
}
