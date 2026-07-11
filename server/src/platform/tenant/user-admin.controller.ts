import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { auditHistoryQuerySchema, AuditAction, PermissionAction, PermissionModule, type AuditHistoryQuery } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  type CreateUserRequest,
  type UpdateUserRequest,
} from './dto/tenant.dto';
import { UserAdminService } from './user-admin.service';

@Controller('admin/users')
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.VIEW)
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(auditHistoryQuerySchema)) query: AuditHistoryQuery,
  ) {
    const { items, meta } = await this.userAdminService.listUsers(tenantId, query.page, query.limit);
    return { data: items, meta };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.VIEW)
  @Get('roles')
  async listRoles(@CurrentTenant() tenantId: string) {
    const data = await this.userAdminService.listRoles(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: 'User', action: AuditAction.CREATE })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createUserRequestSchema)) dto: CreateUserRequest,
  ) {
    const user = await this.userAdminService.createUser({ tenantId, ...dto });
    return {
      data: user,
      audit: { entityId: user.id, before: null, after: user as unknown as Record<string, unknown> },
    };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.EDIT)
  @Audited({ entityType: 'User', action: AuditAction.UPDATE })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserRequestSchema)) dto: UpdateUserRequest,
  ) {
    const { before, after } = await this.userAdminService.updateUser(tenantId, id, dto);
    return {
      data: after,
      audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> },
    };
  }
}
