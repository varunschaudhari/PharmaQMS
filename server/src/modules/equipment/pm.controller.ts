import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import {
  CurrentSigningContext,
  type SigningContext,
} from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  completePmTaskRequestSchema,
  upsertPmPlanRequestSchema,
  type CompletePmTaskRequest,
  type UpsertPmPlanRequest,
} from './dto/equipment.dto';
import { PmService } from './pm.service';

// EQP-9: preventive-maintenance plans/tasks. Plan management is an engineering action
// (equipment:edit); completion is a single-step e-signature (Iron Rule 4).
@Controller('equipment')
export class PmController {
  constructor(private readonly pmService: PmService) {}

  // Registered ahead of the nested `:id/...` routes — 'pm-tasks' has two path segments
  // ('pm-tasks', 'open') so it never collides with EquipmentController's `GET /equipment/:id`.
  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get('pm-tasks/open')
  async listOpen(@CurrentTenant() tenantId: string) {
    const data = await this.pmService.listOpenTasks(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @Post(':id/pm-plan')
  async upsertPlan(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertPmPlanRequestSchema)) dto: UpsertPmPlanRequest,
  ) {
    const { after } = await this.pmService.upsertPlan(tenantId, id, { userId: user.userId, fullName: user.fullName }, dto);
    return { data: after };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/pm-plan')
  async getPlan(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.pmService.getPlan(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.VIEW)
  @Get(':id/pm-tasks')
  async listForEquipment(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.pmService.listTasksForEquipment(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.EQUIPMENT, PermissionAction.EDIT)
  @UseGuards(SignatureGuard)
  @Post('pm-tasks/:taskId/complete')
  async complete(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(completePmTaskRequestSchema)) dto: CompletePmTaskRequest,
  ) {
    const data = await this.pmService.completeTask(tenantId, taskId, signer, dto.completionNote);
    return { data };
  }
}
