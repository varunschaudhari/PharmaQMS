import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { auditHistoryQuerySchema, type AuditHistoryQuery } from '@pharmaqms/shared';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { auditEventsToCsv } from './csv.util';

// PLT-2: generic per-record history + CSV export, shared by every future business module.
// No extra @RequirePermission() beyond authentication (already enforced globally) — a caller can
// only have an entityId to ask about if they reached it through that module's own view-gated
// endpoint in the first place; finer per-module authorization can layer on top later.
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(':entityType/:entityId/history')
  async getHistory(
    @CurrentTenant() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query(new ZodValidationPipe(auditHistoryQuerySchema)) query: AuditHistoryQuery,
  ) {
    const { items, total } = await this.auditService.findHistory(
      tenantId,
      entityType,
      entityId,
      query.page,
      query.limit,
    );
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  @Get(':entityType/:entityId/history/export')
  async exportRecordHistory(
    @CurrentTenant() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Res() res: Response,
  ): Promise<void> {
    const events = await this.auditService.findAllForRecord(tenantId, entityType, entityId);
    sendCsv(res, `${entityType}-${entityId}-history.csv`, auditEventsToCsv(events));
  }

  @Get(':entityType/export')
  async exportModuleHistory(
    @CurrentTenant() tenantId: string,
    @Param('entityType') entityType: string,
    @Res() res: Response,
  ): Promise<void> {
    const events = await this.auditService.findAllForModule(tenantId, entityType);
    sendCsv(res, `${entityType}-history.csv`, auditEventsToCsv(events));
  }
}

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
