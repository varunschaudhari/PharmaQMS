import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuditAction } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createTenantRequestSchema,
  updateTenantSettingsRequestSchema,
  type CreateTenantRequest,
  type UpdateTenantSettingsRequest,
} from './dto/tenant.dto';
import { TenantService } from './tenant.service';

// PLT-8: tenant provisioning is platform-admin only (SPEC.md §4 "System Admin (Varun/support)")
// — a cross-tenant concern, orthogonal to any single tenant's own permission matrix.
@UseGuards(PlatformAdminGuard)
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async list() {
    const data = await this.tenantService.listTenants();
    return { data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.tenantService.findById(id);
    return { data };
  }

  @Audited({ entityType: 'Tenant', action: AuditAction.CREATE })
  @Post()
  async create(@Body(new ZodValidationPipe(createTenantRequestSchema)) dto: CreateTenantRequest) {
    const tenant = await this.tenantService.provisionTenant(dto);
    return {
      data: tenant,
      audit: { entityId: tenant.id, before: null, after: tenant as unknown as Record<string, unknown> },
    };
  }

  @Audited({ entityType: 'Tenant', action: AuditAction.UPDATE })
  @Patch(':id/settings')
  async updateSettings(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTenantSettingsRequestSchema)) dto: UpdateTenantSettingsRequest,
  ) {
    const { before, after } = await this.tenantService.updateSettings(id, dto.settings);
    return {
      data: after,
      audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> },
    };
  }
}
