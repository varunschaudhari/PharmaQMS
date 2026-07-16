import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createRoomCleaningAmendmentRequestSchema,
  logRoomCleaningRequestSchema,
  upsertRoomCleaningScheduleRequestSchema,
  type CreateRoomCleaningAmendmentRequest,
  type LogRoomCleaningRequest,
  type UpsertRoomCleaningScheduleRequest,
} from './dto/room.dto';
import { RoomCleaningService } from './room-cleaning.service';

// QRX-1: the room's cleaning schedule + digital cleaning log. Logging a cleaning entry needs only
// authentication — the authenticated QR scan itself is the access control (same "no elevated
// permission" pattern as EQP-6's logbook).
@Controller('rooms')
export class RoomCleaningController {
  constructor(private readonly roomCleaningService: RoomCleaningService) {}

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.EDIT)
  @Post(':id/cleaning-schedule')
  async upsertSchedule(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertRoomCleaningScheduleRequestSchema)) dto: UpsertRoomCleaningScheduleRequest,
  ) {
    const { after } = await this.roomCleaningService.upsertSchedule(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto);
    return { data: after };
  }

  @RequirePermission(PermissionModule.ROOMS, PermissionAction.VIEW)
  @Get(':id/cleaning-schedule')
  async getSchedule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.roomCleaningService.getSchedule(tenantId, id);
    return { data };
  }

  // QRX-1 (d): QA-dashboard overdue-rooms feed. Registered before the `:id/...` routes below are
  // reached by the router only because it has a distinct 3-segment shape (`cleaning/due` vs a
  // single `:id` segment) — no collision, but keeping it near the top for readability.
  @RequirePermission(PermissionModule.ROOMS, PermissionAction.VIEW)
  @Get('cleaning/due')
  async listCleaningDue(@CurrentTenant() tenantId: string) {
    const data = await this.roomCleaningService.listCleaningDue(tenantId);
    return { data };
  }

  @Post(':id/cleaning-entries')
  async logCleaning(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logRoomCleaningRequestSchema)) dto: LogRoomCleaningRequest,
  ) {
    const data = await this.roomCleaningService.logCleaning(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto.cleaningType, dto.remarks);
    return { data };
  }

  @Post(':id/cleaning-entries/:entryId/amend')
  async amend(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body(new ZodValidationPipe(createRoomCleaningAmendmentRequestSchema)) dto: CreateRoomCleaningAmendmentRequest,
  ) {
    const data = await this.roomCleaningService.createAmendment(tenantId, id, { userId: user.userId, fullName: user.fullName }, entryId, dto.description);
    return { data };
  }

  @Get(':id/cleaning-entries')
  async list(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.roomCleaningService.listForRoom(tenantId, id);
    return { data };
  }
}
