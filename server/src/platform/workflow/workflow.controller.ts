import { Body, Controller, Get, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  AuditAction,
  ErrorCode,
  PermissionAction,
  PermissionModule,
  WorkflowAction,
  WORKFLOW_SUBMIT_ENTITY_TYPE_PERMISSION,
  type AuthenticatedUser,
} from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  actOnWorkflowStepRequestSchema,
  createWorkflowTemplateRequestSchema,
  submitWorkflowRequestSchema,
  updateWorkflowTemplateRequestSchema,
  type ActOnWorkflowStepRequest,
  type CreateWorkflowTemplateRequest,
  type SubmitWorkflowRequest,
  type UpdateWorkflowTemplateRequest,
} from './dto/workflow.dto';
import { WorkflowService } from './workflow.service';

const REASSIGN_PERMISSION_KEY = `${PermissionModule.ADMIN}:${PermissionAction.ADMIN}`;

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: 'WorkflowTemplate', action: AuditAction.CREATE })
  @Post('templates')
  async createTemplate(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(createWorkflowTemplateRequestSchema)) dto: CreateWorkflowTemplateRequest,
  ) {
    const template = await this.workflowService.createTemplate({ tenantId, ...dto });
    return {
      data: template,
      audit: { entityId: template.id, before: null, after: template as unknown as Record<string, unknown> },
    };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.VIEW)
  @Get('templates')
  async listTemplates(@CurrentTenant() tenantId: string) {
    const data = await this.workflowService.listTemplates(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.EDIT)
  @Audited({ entityType: 'WorkflowTemplate', action: AuditAction.UPDATE })
  @Patch('templates/:id')
  async updateTemplate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowTemplateRequestSchema)) dto: UpdateWorkflowTemplateRequest,
  ) {
    const { before, after } = await this.workflowService.updateTemplate(tenantId, id, dto);
    return {
      data: after,
      audit: { entityId: after.id, before, after: after as unknown as Record<string, unknown> },
    };
  }

  // entityType/action are supplied dynamically in `audit` below — see AuditPayload's comment for
  // why a generic, entity-agnostic engine can't use @Audited()'s static defaults alone.
  @Audited({ entityType: 'Workflow', action: AuditAction.WORKFLOW_SUBMITTED })
  @Post('instances/submit')
  async submit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitWorkflowRequestSchema)) dto: SubmitWorkflowRequest,
  ) {
    // Session 19 hardening pass: this generic endpoint is reachable by any authenticated tenant
    // user, so an entityType with its own module-level edit permission (see
    // WORKFLOW_SUBMIT_ENTITY_TYPE_PERMISSION's header comment) must still be gated here —
    // otherwise a caller with no permission on that module could submit straight through this
    // endpoint instead of the module's own permission-gated wrapper.
    const requiredPermission = WORKFLOW_SUBMIT_ENTITY_TYPE_PERMISSION[dto.entityType];
    if (requiredPermission && !user.permissions.includes(requiredPermission)) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You do not have permission to submit this entity type for approval.',
        HttpStatus.FORBIDDEN,
      );
    }

    const { before, after } = await this.workflowService.submit(tenantId, dto.entityType, dto.entityId, {
      userId: user.userId,
      fullName: user.fullName,
      roleId: user.roleId,
    });
    return {
      data: after,
      audit: {
        entityId: after.entityId,
        entityType: after.entityType,
        before,
        after: after as unknown as Record<string, unknown>,
      },
    };
  }

  // No extra @RequirePermission() beyond authentication — any tenant user reviewing an approval
  // (e.g. via the WorkflowInstancePage) needs to see the instance's own status/step/history;
  // findInstanceOrThrow() is tenant-scoped, so a foreign tenant's instance id 404s regardless.
  @Get('instances/:id')
  async getInstance(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.workflowService.getInstance(tenantId, id);
    return { data };
  }

  @Get('my-pending-tasks')
  async myPendingTasks(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.workflowService.myPendingTasks(tenantId, {
      userId: user.userId,
      fullName: user.fullName,
      roleId: user.roleId,
    });
    return { data };
  }

  @Audited({ entityType: 'Workflow', action: AuditAction.WORKFLOW_STEP_APPROVED })
  @Post('instances/:id/act')
  async actOnStep(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(actOnWorkflowStepRequestSchema)) dto: ActOnWorkflowStepRequest,
  ) {
    // REASSIGN is an admin-only action (SPEC.md §6.1) — the other two branches (approve/reject)
    // are gated by assignee eligibility inside WorkflowService instead of a permission check,
    // since all three share this one endpoint and Nest guards apply to the whole route.
    if (dto.action === WorkflowAction.REASSIGN && !user.permissions.includes(REASSIGN_PERMISSION_KEY)) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'Reassigning a workflow step requires admin permission.',
        HttpStatus.FORBIDDEN,
      );
    }

    const result = await this.workflowService.actOnStep(
      tenantId,
      id,
      { userId: user.userId, fullName: user.fullName, roleId: user.roleId },
      dto,
    );
    return {
      data: result.after,
      audit: {
        entityId: result.after.entityId,
        entityType: result.after.entityType,
        action: result.auditAction,
        before: result.before,
        after: result.after as unknown as Record<string, unknown>,
        reason: result.comment,
      },
    };
  }
}
