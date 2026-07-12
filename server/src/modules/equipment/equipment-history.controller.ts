import { Controller, Get, Param, Res } from '@nestjs/common';
import { PermissionAction, PermissionModule } from '@pharmaqms/shared';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EquipmentHistoryReportService } from './equipment-history-report.service';

// EQP-10: full-lifecycle equipment history PDF — a read-only report, equipment:view gated like
// every other equipment sub-record read (no signature; nothing is being attested here).
@Controller('equipment')
export class EquipmentHistoryController {
  constructor(private readonly reportService: EquipmentHistoryReportService) {}

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/history-report.pdf')
  async historyReportPdf(@CurrentTenant() tenantId: string, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const pdf = await this.reportService.generatePdf(tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="equipment-history-${id}.pdf"`);
    res.send(pdf);
  }
}
