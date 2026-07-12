import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionAction, PermissionModule } from '@pharmaqms/shared';
import {
  CurrentSigningContext,
  type SigningContext,
} from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@pharmaqms/shared';
import {
  closeMaintenanceTaskRequestSchema,
  verifyMaintenanceTaskRequestSchema,
  type CloseMaintenanceTaskRequest,
  type VerifyMaintenanceTaskRequest,
} from './dto/equipment.dto';
import { MaintenanceService } from './maintenance.service';

// EQP-7: maintenance task closure/verification. Closure is an engineering action
// (equipment:edit); verification is a QA sign-off (equipment:approve + SignatureGuard) — the
// same split as EQP-4/5's calibration record/verify endpoints.
@Controller('equipment')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  // Registered ahead of the nested `:id/...` routes below for readability — 'maintenance-tasks'
  // has two path segments ('maintenance-tasks', 'open') so it never collides with
  // EquipmentController's single-segment `GET /equipment/:id`.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('maintenance-tasks/open')
  async listOpen(@CurrentTenant() tenantId: string) {
    const data = await this.maintenanceService.listOpen(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/maintenance-tasks')
  async listForEquipment(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.maintenanceService.listForEquipment(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Post('maintenance-tasks/:taskId/close')
  async close(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(closeMaintenanceTaskRequestSchema)) dto: CloseMaintenanceTaskRequest,
  ) {
    const data = await this.maintenanceService.close(tenantId, taskId, { userId: user.userId, fullName: user.fullName }, dto.completionNote);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post('maintenance-tasks/:taskId/verify')
  async verify(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(verifyMaintenanceTaskRequestSchema)) dto: VerifyMaintenanceTaskRequest,
  ) {
    const data = await this.maintenanceService.verify(tenantId, taskId, signer, dto.note ?? null);
    return { data };
  }
}
