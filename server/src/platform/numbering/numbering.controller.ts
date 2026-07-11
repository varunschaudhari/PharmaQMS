import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createNumberingSchemeRequestSchema,
  generateNumberRequestSchema,
  updateNumberingSchemeRequestSchema,
  type CreateNumberingSchemeRequest,
  type GenerateNumberRequest,
  type UpdateNumberingSchemeRequest,
} from './dto/numbering.dto';
import { NumberingService } from './numbering.service';

@Controller('numbering')
export class NumberingController {
  constructor(private readonly numberingService: NumberingService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.VIEW)
  @Get('schemes')
  async listSchemes(@CurrentTenant() tenantId: string) {
    const data = await this.numberingService.listSchemes(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: 'NumberingScheme', action: AuditAction.CREATE })
  @Post('schemes')
  async createScheme(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createNumberingSchemeRequestSchema)) dto: CreateNumberingSchemeRequest,
  ) {
    const scheme = await this.numberingService.createScheme({ tenantId, ...dto });
    return { data: scheme, audit: { entityId: scheme.id, before: null, after: scheme as unknown as Record<string, unknown> } };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.EDIT)
  @Audited({ entityType: 'NumberingScheme', action: AuditAction.UPDATE })
  @Patch('schemes/:id')
  async updateScheme(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateNumberingSchemeRequestSchema)) dto: UpdateNumberingSchemeRequest,
  ) {
    const { before, after } = await this.numberingService.updateScheme(tenantId, id, dto);
    return { data: after, audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> } };
  }

  // Preview/manual-issue endpoint — real usage is other services calling
  // NumberingService.generateNumber() in-process once DOC/EQP/TRN modules exist (CLAUDE.md:
  // "Entity codes come from PLT-5 — never generate identifiers inline").
  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Post('generate')
  async generate(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(generateNumberRequestSchema)) dto: GenerateNumberRequest,
  ) {
    const code = await this.numberingService.generateNumber(tenantId, dto.entityType, dto.departmentCode);
    return { data: { code } };
  }
}
