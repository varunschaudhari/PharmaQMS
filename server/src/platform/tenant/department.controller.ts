import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DepartmentService } from './department.service';
import {
  createDepartmentRequestSchema,
  updateDepartmentRequestSchema,
  type CreateDepartmentRequest,
  type UpdateDepartmentRequest,
} from './dto/tenant.dto';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.VIEW)
  @Get()
  async list(@CurrentTenant() tenantId: string) {
    const data = await this.departmentService.list(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: 'Department', action: AuditAction.CREATE })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createDepartmentRequestSchema)) dto: CreateDepartmentRequest,
  ) {
    const department = await this.departmentService.create({ tenantId, ...dto });
    return {
      data: department,
      audit: { entityId: department.id, before: null, after: department as unknown as Record<string, unknown> },
    };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.EDIT)
  @Audited({ entityType: 'Department', action: AuditAction.UPDATE })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDepartmentRequestSchema)) dto: UpdateDepartmentRequest,
  ) {
    const { before, after } = await this.departmentService.update(tenantId, id, dto);
    return {
      data: after,
      audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> },
    };
  }
}
