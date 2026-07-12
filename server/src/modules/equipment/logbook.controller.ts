import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '@pharmaqms/shared';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createLogbookAmendmentRequestSchema,
  logBreakdownRequestSchema,
  logCleaningRequestSchema,
  logUsageStartRequestSchema,
  logUsageStopRequestSchema,
  type CreateLogbookAmendmentRequest,
  type LogBreakdownRequest,
  type LogCleaningRequest,
  type LogUsageStartRequest,
  type LogUsageStopRequest,
} from './dto/equipment.dto';
import { LogbookService, type UploadedPhoto } from './logbook.service';

// EQP-6/EQP-7: the digital logbook. Every logging action needs only authentication — the
// authenticated QR scan itself is the access control (same "no elevated permission" pattern as
// EQP-3's status card / EQP-1's role-driven action stubs it replaces).
@Controller('equipment')
export class LogbookController {
  constructor(private readonly logbookService: LogbookService) {}

  @Post(':id/logbook/usage-start')
  async usageStart(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logUsageStartRequestSchema)) dto: LogUsageStartRequest,
  ) {
    const data = await this.logbookService.logUsageStart(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto.productBatchRef);
    return { data };
  }

  @Post(':id/logbook/usage-stop')
  async usageStop(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logUsageStopRequestSchema)) dto: LogUsageStopRequest,
  ) {
    const data = await this.logbookService.logUsageStop(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto.productBatchRef);
    return { data };
  }

  @Post(':id/logbook/cleaning')
  async cleaning(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logCleaningRequestSchema)) dto: LogCleaningRequest,
  ) {
    const data = await this.logbookService.logCleaning(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto.cleaningType);
    return { data };
  }

  @UseInterceptors(FileInterceptor('photo'))
  @Post(':id/logbook/breakdown')
  async breakdown(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logBreakdownRequestSchema)) dto: LogBreakdownRequest,
    @UploadedFile() photo: UploadedPhoto | undefined,
  ) {
    const data = await this.logbookService.logBreakdown(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto.description, photo ?? null);
    return { data };
  }

  @Post(':id/logbook/:entryId/amend')
  async amend(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body(new ZodValidationPipe(createLogbookAmendmentRequestSchema)) dto: CreateLogbookAmendmentRequest,
  ) {
    const data = await this.logbookService.createAmendment(tenantId, id, { userId: user.userId, fullName: user.fullName }, entryId, dto.description);
    return { data };
  }

  @Get(':id/logbook')
  async list(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.logbookService.listForEquipment(tenantId, id);
    return { data };
  }

  @Get(':id/logbook/:entryId/photo')
  async photo(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.logbookService.getPhoto(tenantId, id, entryId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(file.buffer);
  }
}
