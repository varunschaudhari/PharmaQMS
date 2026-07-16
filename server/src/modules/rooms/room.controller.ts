import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createRoomRequestSchema,
  listRoomsQuerySchema,
  transitionRoomStatusRequestSchema,
  updateRoomRequestSchema,
  type CreateRoomRequest,
  type ListRoomsQuery,
  type TransitionRoomStatusRequest,
  type UpdateRoomRequest,
} from './dto/room.dto';
import { ROOM_ENTITY_TYPE } from './room-entity-types';
import { RoomService } from './room.service';

// QRX-1: room master + QR + cleaning status card. The status card needs only authentication (any
// operator scanning a label must see it — the scan itself, via /s/:code, is the access gate),
// matching EQP-3's precedent exactly.
@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.CREATE)
  @Audited({ entityType: ROOM_ENTITY_TYPE, action: AuditAction.CREATE })
  @Post()
  async create(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(createRoomRequestSchema)) dto: CreateRoomRequest) {
    const room = await this.roomService.create(tenantId, dto);
    return {
      data: room,
      audit: { entityId: room.id, before: null, after: { roomCode: room.roomCode, name: room.name, block: room.block } },
    };
  }

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.EDIT)
  @Audited({ entityType: ROOM_ENTITY_TYPE, action: AuditAction.UPDATE })
  @Patch(':id')
  async update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body(new ZodValidationPipe(updateRoomRequestSchema)) dto: UpdateRoomRequest) {
    const { before, after } = await this.roomService.update(tenantId, id, dto);
    return { data: after, audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> } };
  }

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.EDIT)
  @Audited({ entityType: ROOM_ENTITY_TYPE, action: AuditAction.STATUS_CHANGE })
  @Post(':id/status')
  async transitionStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionRoomStatusRequestSchema)) dto: TransitionRoomStatusRequest,
  ) {
    const { before, after } = await this.roomService.transitionStatus(tenantId, id, dto.status);
    return { data: after, audit: { entityId: after.id, before, after: { status: after.status }, reason: dto.reason ?? null } };
  }

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.VIEW)
  @Get()
  async list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listRoomsQuerySchema)) query: ListRoomsQuery) {
    const { items, total } = await this.roomService.list(tenantId, query);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.VIEW)
  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.roomService.get(tenantId, id);
    return { data };
  }

  // QRX-1: reached by the mobile scan flow — any authenticated tenant user.
  @Get(':id/status-card')
  async statusCard(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.roomService.getStatusCard(tenantId, id);
    return { data };
  }
}
