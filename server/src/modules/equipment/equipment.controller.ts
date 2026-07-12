import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createEquipmentRequestSchema,
  listEquipmentQuerySchema,
  transitionEquipmentStatusRequestSchema,
  updateEquipmentRequestSchema,
  type CreateEquipmentRequest,
  type ListEquipmentQuery,
  type TransitionEquipmentStatusRequest,
  type UpdateEquipmentRequest,
} from './dto/equipment.dto';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { EquipmentService } from './equipment.service';

// EQP-1/EQP-2/EQP-3: equipment master + QR + status card. The status card needs only
// authentication (any operator scanning a label must see it — the scan itself, via /s/:code, is
// the access gate), matching the QR-resolve/workflow-pending-tasks "no extra permission" pattern.
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.CREATE)
  @Audited({ entityType: EQUIPMENT_ENTITY_TYPE, action: AuditAction.CREATE })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createEquipmentRequestSchema)) dto: CreateEquipmentRequest,
  ) {
    const equipment = await this.equipmentService.create(tenantId, dto);
    return {
      data: equipment,
      audit: {
        entityId: equipment.id,
        before: null,
        after: { equipmentCode: equipment.equipmentCode, name: equipment.name, location: equipment.location },
      },
    };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Audited({ entityType: EQUIPMENT_ENTITY_TYPE, action: AuditAction.UPDATE })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEquipmentRequestSchema)) dto: UpdateEquipmentRequest,
  ) {
    const { before, after } = await this.equipmentService.update(tenantId, id, dto);
    return { data: after, audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> } };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Audited({ entityType: EQUIPMENT_ENTITY_TYPE, action: AuditAction.STATUS_CHANGE })
  @Post(':id/status')
  async transitionStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionEquipmentStatusRequestSchema)) dto: TransitionEquipmentStatusRequest,
  ) {
    const { before, after } = await this.equipmentService.transitionStatus(tenantId, id, dto.status);
    return {
      data: after,
      audit: { entityId: after.id, before, after: { status: after.status }, reason: dto.reason ?? null },
    };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listEquipmentQuerySchema)) query: ListEquipmentQuery,
  ) {
    const { items, total } = await this.equipmentService.list(tenantId, query);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.equipmentService.get(tenantId, id);
    return { data };
  }

  // EQP-3: reached by the mobile scan flow — any authenticated tenant user.
  @Get(':id/status-card')
  async statusCard(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.equipmentService.getStatusCard(tenantId, id, {
      userId: user.userId,
      fullName: user.fullName,
      permissions: user.permissions,
    });
    return { data };
  }
}
