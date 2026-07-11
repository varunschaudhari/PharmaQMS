import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  WorkflowAction,
  WorkflowInstanceStatus,
  assertWorkflowActionAllowed,
  type ActOnWorkflowStepRequest,
  type WorkflowInstanceData,
  type WorkflowStepChangedEvent,
  type WorkflowTemplateData,
  type WorkflowTemplateStepData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { EsignService } from '../esign/esign.service';
import {
  WorkflowInstance,
  WorkflowInstanceDocument,
} from './schemas/workflow-instance.schema';
import {
  WorkflowTemplate,
  WorkflowTemplateDocument,
  WorkflowTemplateStep,
} from './schemas/workflow-template.schema';

export interface CreateWorkflowTemplateInput {
  tenantId: string;
  entityType: string;
  name: string;
  steps: WorkflowTemplateStepData[];
}

export interface UpdateWorkflowTemplateInput {
  name?: string;
  steps?: WorkflowTemplateStepData[];
  isActive?: boolean;
}

export interface WorkflowActor {
  userId: string;
  fullName: string;
  roleId: string;
}

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(WorkflowTemplate.name) private readonly templateModel: Model<WorkflowTemplateDocument>,
    @InjectModel(WorkflowInstance.name) private readonly instanceModel: Model<WorkflowInstanceDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly esignService: EsignService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createTemplate(input: CreateWorkflowTemplateInput): Promise<WorkflowTemplateData> {
    const existing = await this.templateModel.findOne({ tenantId: input.tenantId, entityType: input.entityType });
    if (existing) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `A workflow template for entityType "${input.entityType}" already exists.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const doc = await this.templateModel.create({
      tenantId: input.tenantId,
      entityType: input.entityType,
      name: input.name,
      steps: input.steps,
    });
    return toTemplateData(doc);
  }

  async updateTemplate(
    tenantId: string,
    templateId: string,
    input: UpdateWorkflowTemplateInput,
  ): Promise<{ before: Record<string, unknown>; after: WorkflowTemplateData }> {
    const template = await this.findTemplateByIdOrThrow(tenantId, templateId);
    const before = templateSnapshot(template);

    if (input.name !== undefined) template.name = input.name;
    if (input.steps !== undefined) template.steps = input.steps as unknown as WorkflowTemplateStep[];
    if (input.isActive !== undefined) template.isActive = input.isActive;
    await template.save();

    return { before, after: toTemplateData(template) };
  }

  async listTemplates(tenantId: string): Promise<WorkflowTemplateData[]> {
    const docs = await this.templateModel.find({ tenantId }).sort({ entityType: 1 }).lean();
    return docs.map(toTemplateData);
  }

  // PLT-4: finds-or-creates the instance for this entity and moves it DRAFT -> IN_PROGRESS at
  // step 0. Re-submitting after a rejection reuses the same instance (one instance per entity).
  async submit(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<{ before: Record<string, unknown> | null; after: WorkflowInstanceData }> {
    const template = await this.findTemplateForEntityTypeOrThrow(tenantId, entityType);
    if (template.steps.length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Workflow template has no steps configured.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let instance = await this.instanceModel.findOne({ tenantId, entityType, entityId });
    const before = instance ? instanceSnapshot(instance) : null;

    if (!instance) {
      instance = new this.instanceModel({
        tenantId,
        templateId: template._id,
        entityType,
        entityId,
        status: WorkflowInstanceStatus.DRAFT,
        currentStepIndex: -1,
        currentStepRoleId: null,
        overrideAssigneeUserId: null,
      });
    }

    assertWorkflowActionAllowed(instance.status, WorkflowAction.SUBMIT);

    const firstStep = template.steps[0];
    instance.status = WorkflowInstanceStatus.IN_PROGRESS;
    instance.currentStepIndex = 0;
    instance.currentStepRoleId = firstStep.roleId.toString();
    instance.overrideAssigneeUserId = null;
    await instance.save();

    return { before, after: toInstanceData(instance, template) };
  }

  async getInstance(tenantId: string, instanceId: string): Promise<WorkflowInstanceData> {
    const instance = await this.findInstanceOrThrow(tenantId, instanceId);
    const template = await this.findTemplateByIdOrThrow(tenantId, instance.templateId.toString());
    return toInstanceData(instance, template);
  }

  async myPendingTasks(tenantId: string, actor: WorkflowActor): Promise<WorkflowInstanceData[]> {
    const instances = await this.instanceModel
      .find({
        tenantId,
        status: WorkflowInstanceStatus.IN_PROGRESS,
        $or: [
          { overrideAssigneeUserId: actor.userId },
          { overrideAssigneeUserId: null, currentStepRoleId: actor.roleId },
        ],
      })
      .sort({ updatedAt: 1 })
      .exec();

    const templateIds = [...new Set(instances.map((instance) => instance.templateId.toString()))];
    const templates = await this.templateModel.find({ tenantId, _id: { $in: templateIds } });
    const templatesById = new Map(templates.map((template) => [template._id.toString(), template]));

    return instances.map((instance) => toInstanceData(instance, templatesById.get(instance.templateId.toString())!));
  }

  async actOnStep(
    tenantId: string,
    instanceId: string,
    actor: WorkflowActor,
    dto: ActOnWorkflowStepRequest,
  ): Promise<{ before: Record<string, unknown>; after: WorkflowInstanceData; auditAction: AuditAction; comment: string | null }> {
    const instance = await this.findInstanceOrThrow(tenantId, instanceId);
    const template = await this.findTemplateByIdOrThrow(tenantId, instance.templateId.toString());

    if (dto.action === WorkflowAction.REJECT) {
      return this.reject(instance, template, actor, dto.comment);
    }
    if (dto.action === WorkflowAction.REASSIGN) {
      return this.reassign(tenantId, instance, template, dto.userId, dto.reason);
    }
    return this.approve(instance, template, actor, dto.signingToken, dto.entitySnapshot, dto.comment ?? null);
  }

  private async approve(
    instance: WorkflowInstanceDocument,
    template: WorkflowTemplateDocument,
    actor: WorkflowActor,
    signingToken: string,
    entitySnapshot: Record<string, unknown>,
    comment: string | null,
  ) {
    assertWorkflowActionAllowed(instance.status, WorkflowAction.APPROVE);
    const step = this.currentStepOrThrow(template, instance.currentStepIndex);
    this.assertEligibleAssignee(instance, step, actor);

    // PLT-3 / Iron Rule 4: approving IS an e-signature. verifyAndConsumeSigningToken enforces a
    // fresh, single-use credential challenge — a valid session alone is never sufficient.
    const signingContext = await this.esignService.verifyAndConsumeSigningToken(signingToken, actor.userId);
    await this.esignService.createSignature({
      tenantId: instance.tenantId.toString(),
      userId: signingContext.userId,
      userFullName: signingContext.fullName,
      meaning: step.signatureMeaning,
      entityType: instance.entityType,
      entityId: instance.entityId,
      entitySnapshot,
      reason: comment,
    });

    const before = instanceSnapshot(instance);
    const fromStepIndex = instance.currentStepIndex;
    const isFinalStep = instance.currentStepIndex >= template.steps.length - 1;

    if (isFinalStep) {
      instance.status = WorkflowInstanceStatus.APPROVED;
      instance.currentStepRoleId = null;
    } else {
      instance.currentStepIndex += 1;
      instance.currentStepRoleId = template.steps[instance.currentStepIndex].roleId.toString();
    }
    instance.overrideAssigneeUserId = null;
    await instance.save();

    this.emitStepChanged(instance, WorkflowAction.APPROVE, before.status as WorkflowInstanceStatus, fromStepIndex, actor, comment);

    return {
      before,
      after: toInstanceData(instance, template),
      auditAction: isFinalStep ? AuditAction.WORKFLOW_APPROVED : AuditAction.WORKFLOW_STEP_APPROVED,
      comment,
    };
  }

  private async reject(
    instance: WorkflowInstanceDocument,
    template: WorkflowTemplateDocument,
    actor: WorkflowActor,
    comment: string,
  ) {
    assertWorkflowActionAllowed(instance.status, WorkflowAction.REJECT);
    const step = this.currentStepOrThrow(template, instance.currentStepIndex);
    this.assertEligibleAssignee(instance, step, actor);

    const before = instanceSnapshot(instance);
    const fromStepIndex = instance.currentStepIndex;

    if (step.rejectToStepIndex === null || step.rejectToStepIndex === undefined) {
      instance.status = WorkflowInstanceStatus.DRAFT;
      instance.currentStepIndex = -1;
      instance.currentStepRoleId = null;
    } else {
      instance.status = WorkflowInstanceStatus.IN_PROGRESS;
      instance.currentStepIndex = step.rejectToStepIndex;
      instance.currentStepRoleId = template.steps[step.rejectToStepIndex].roleId.toString();
    }
    instance.overrideAssigneeUserId = null;
    await instance.save();

    this.emitStepChanged(instance, WorkflowAction.REJECT, before.status as WorkflowInstanceStatus, fromStepIndex, actor, comment);

    return {
      before,
      after: toInstanceData(instance, template),
      auditAction: AuditAction.WORKFLOW_REJECTED,
      comment,
    };
  }

  private async reassign(
    tenantId: string,
    instance: WorkflowInstanceDocument,
    template: WorkflowTemplateDocument,
    targetUserId: string,
    reason: string,
  ) {
    assertWorkflowActionAllowed(instance.status, WorkflowAction.REASSIGN);

    const targetUser = await this.userModel.findOne({ _id: targetUserId, tenantId, isActive: true });
    if (!targetUser) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Target user not found or inactive.', HttpStatus.NOT_FOUND);
    }

    const before = instanceSnapshot(instance);
    instance.overrideAssigneeUserId = targetUserId;
    await instance.save();

    return {
      before,
      after: toInstanceData(instance, template),
      auditAction: AuditAction.WORKFLOW_REASSIGNED,
      comment: reason,
    };
  }

  private assertEligibleAssignee(
    instance: WorkflowInstanceDocument,
    step: WorkflowTemplateStep,
    actor: WorkflowActor,
  ): void {
    if (instance.overrideAssigneeUserId) {
      if (instance.overrideAssigneeUserId !== actor.userId) {
        throw new AppException(
          ErrorCode.PERMISSION_DENIED,
          'This step has been reassigned to a different user.',
          HttpStatus.FORBIDDEN,
        );
      }
      return;
    }
    if (actor.roleId !== step.roleId.toString()) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You are not an eligible assignee for this workflow step.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private currentStepOrThrow(template: WorkflowTemplateDocument, stepIndex: number): WorkflowTemplateStep {
    const step = template.steps[stepIndex];
    if (!step) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'This workflow instance is not currently at a valid step.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return step;
  }

  private async findTemplateForEntityTypeOrThrow(
    tenantId: string,
    entityType: string,
  ): Promise<WorkflowTemplateDocument> {
    const template = await this.templateModel.findOne({ tenantId, entityType, isActive: true });
    if (!template) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `No active workflow template configured for entityType "${entityType}".`,
        HttpStatus.NOT_FOUND,
      );
    }
    return template;
  }

  private async findTemplateByIdOrThrow(tenantId: string, templateId: string): Promise<WorkflowTemplateDocument> {
    const template = await this.templateModel.findOne({ _id: templateId, tenantId });
    if (!template) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Workflow template not found.', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  private async findInstanceOrThrow(tenantId: string, instanceId: string): Promise<WorkflowInstanceDocument> {
    const instance = await this.instanceModel.findOne({ _id: instanceId, tenantId });
    if (!instance) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Workflow instance not found.', HttpStatus.NOT_FOUND);
    }
    return instance;
  }

  private emitStepChanged(
    instance: WorkflowInstanceDocument,
    action: WorkflowAction,
    fromStatus: WorkflowInstanceStatus,
    fromStepIndex: number,
    actor: WorkflowActor,
    comment: string | null,
  ): void {
    const event: WorkflowStepChangedEvent = {
      tenantId: instance.tenantId.toString(),
      entityType: instance.entityType,
      entityId: instance.entityId,
      instanceId: instance._id.toString(),
      action,
      fromStatus,
      toStatus: instance.status,
      fromStepIndex,
      toStepIndex: instance.currentStepIndex,
      actorId: actor.userId,
      actorFullName: actor.fullName,
      comment,
    };
    // PLT-6 (Notifications) will subscribe to this later — no listeners yet.
    this.eventEmitter.emit('workflow.step-changed', event);
  }
}

function instanceSnapshot(instance: WorkflowInstanceDocument): Record<string, unknown> {
  return {
    status: instance.status,
    currentStepIndex: instance.currentStepIndex,
    currentStepRoleId: instance.currentStepRoleId,
    overrideAssigneeUserId: instance.overrideAssigneeUserId,
  };
}

function toTemplateData(doc: {
  _id: unknown;
  tenantId: unknown;
  entityType: string;
  name: string;
  steps: Array<{ name: string; roleId: unknown; signatureMeaning: WorkflowTemplateStepData['signatureMeaning']; rejectToStepIndex: number | null }>;
  isActive: boolean;
}): WorkflowTemplateData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    entityType: doc.entityType,
    name: doc.name,
    steps: doc.steps.map((step) => ({
      name: step.name,
      roleId: String(step.roleId),
      signatureMeaning: step.signatureMeaning,
      rejectToStepIndex: step.rejectToStepIndex ?? null,
    })),
    isActive: doc.isActive,
  };
}

function templateSnapshot(template: WorkflowTemplateDocument): Record<string, unknown> {
  return {
    name: template.name,
    stepCount: template.steps.length,
    isActive: template.isActive,
  };
}

function toInstanceData(instance: WorkflowInstanceDocument, template: WorkflowTemplateDocument): WorkflowInstanceData {
  const templateData = toTemplateData(template);
  const currentStep = templateData.steps[instance.currentStepIndex] ?? null;
  return {
    id: instance._id.toString(),
    tenantId: instance.tenantId.toString(),
    templateId: instance.templateId.toString(),
    entityType: instance.entityType,
    entityId: instance.entityId,
    status: instance.status,
    currentStepIndex: instance.currentStepIndex,
    currentStep,
    overrideAssigneeUserId: instance.overrideAssigneeUserId,
    totalSteps: templateData.steps.length,
  };
}
