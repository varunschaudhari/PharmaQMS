import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  PmTaskStatus,
  SignatureMeaning,
  type PmPlanData,
  type PmTaskData,
  type UpsertPmPlanRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../../platform/audit/audit.service';
import { EsignService } from '../../platform/esign/esign.service';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { EquipmentService } from './equipment.service';
import { PmPlan, PmPlanDocument } from './schemas/pm-plan.schema';
import { PmTask, PmTaskDocument } from './schemas/pm-task.schema';

export interface PmActor {
  userId: string;
  fullName: string;
}

const MONGO_DUPLICATE_KEY = 11000;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// EQP-9 (SPEC.md §7.3): preventive-maintenance plans + tasks — a sub-concern of the Equipment
// module (same precedent as EQP-4/5/7 — see calibration.service.ts's header comment).
@Injectable()
export class PmService implements OnModuleInit {
  constructor(
    @InjectModel(PmPlan.name) private readonly planModel: Model<PmPlanDocument>,
    @InjectModel(PmTask.name) private readonly taskModel: Model<PmTaskDocument>,
    private readonly equipmentService: EquipmentService,
    private readonly auditService: AuditService,
    private readonly esignService: EsignService,
  ) {}

  // Mongoose builds indexes asynchronously in the background — without this, the very first
  // scan cycle(s) after a cold start could race the (tenantId, planId, dueDate) unique index
  // into existence and create a duplicate PM task (same class of bug PLT-5's NumberingService
  // fixed for its counter index; see NumberingService.onModuleInit).
  async onModuleInit(): Promise<void> {
    await this.taskModel.init();
  }

  // EQP-9: one active plan per equipment — creating again replaces the config in place (same
  // upsert pattern as EQP-4's CalibrationService.upsertSchedule).
  async upsertPlan(
    tenantId: string,
    equipmentId: string,
    actor: PmActor,
    dto: UpsertPmPlanRequest,
  ): Promise<{ before: Record<string, unknown> | null; after: PmPlanData }> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);

    const existing = await this.planModel.findOne({ tenantId, equipmentId });
    const before = existing
      ? { frequencyMonths: existing.frequencyMonths, checklistText: existing.checklistText, nextDueDate: existing.nextDueDate }
      : null;

    const plan = existing ?? new this.planModel({ tenantId, equipmentId });
    plan.frequencyMonths = dto.frequencyMonths;
    plan.checklistText = dto.checklistText;
    plan.nextDueDate = new Date(dto.nextDueDate);
    await plan.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.PM_PLAN_UPSERTED,
      before,
      after: { frequencyMonths: plan.frequencyMonths, checklistText: plan.checklistText, nextDueDate: plan.nextDueDate },
    });

    return { before, after: toPmPlanData(plan) };
  }

  async getPlan(tenantId: string, equipmentId: string): Promise<PmPlanData | null> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const plan = await this.planModel.findOne({ tenantId, equipmentId });
    return plan ? toPmPlanData(plan) : null;
  }

  async listTasksForEquipment(tenantId: string, equipmentId: string): Promise<PmTaskData[]> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const tasks = await this.taskModel.find({ tenantId, equipmentId }).sort({ dueDate: -1 });
    return tasks.map(toPmTaskData);
  }

  // EQP-9: QA/engineering-facing PM queue — every OPEN task, tenant-wide.
  async listOpenTasks(tenantId: string): Promise<PmTaskData[]> {
    const tasks = await this.taskModel.find({ tenantId, status: PmTaskStatus.OPEN }).sort({ dueDate: 1 });
    return tasks.map(toPmTaskData);
  }

  // EQP-9 "auto task generation": called by the daily due-date scanner for every plan whose
  // nextDueDate has arrived. The unique (tenantId, planId, dueDate) index is the idempotency
  // guard — a duplicate-key insert means this due cycle already generated its task.
  async generateTaskIfDue(tenantId: string, plan: PmPlanDocument, now: Date): Promise<PmTaskData | null> {
    if (plan.nextDueDate > now) {
      return null;
    }
    const equipment = await this.equipmentService.findOrThrow(tenantId, plan.equipmentId.toString());
    try {
      const task = await this.taskModel.create({
        tenantId,
        equipmentId: plan.equipmentId,
        equipmentCode: equipment.equipmentCode,
        equipmentName: equipment.name,
        planId: plan._id,
        status: PmTaskStatus.OPEN,
        dueDate: plan.nextDueDate,
      });
      await this.auditService.record({
        tenantId,
        actor: null,
        entityType: EQUIPMENT_ENTITY_TYPE,
        entityId: plan.equipmentId.toString(),
        action: AuditAction.PM_TASK_GENERATED,
        before: null,
        after: { dueDate: plan.nextDueDate },
      });
      return toPmTaskData(task);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }
  }

  // EQP-9 / Iron Rule 4: PM completion IS an e-signature — a single step (unlike EQP-7's
  // separate engineer-completion + configurable QA-verification).
  async completeTask(
    tenantId: string,
    taskId: string,
    signer: SigningContext,
    completionNote: string,
  ): Promise<PmTaskData> {
    const task = await this.taskModel.findOne({ _id: taskId, tenantId });
    if (!task) {
      throw new AppException(ErrorCode.NOT_FOUND, 'PM task not found.', HttpStatus.NOT_FOUND);
    }
    if (task.status !== PmTaskStatus.OPEN) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'This PM task has already been completed.', HttpStatus.BAD_REQUEST);
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.PM_COMPLETED,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: task.equipmentId.toString(),
      entitySnapshot: { taskId: task._id.toString(), dueDate: task.dueDate.toISOString(), completionNote },
      reason: null,
    });

    task.status = PmTaskStatus.COMPLETED;
    task.completionNote = completionNote;
    task.completedByUserId = signer.userId;
    task.completedAt = new Date();
    await task.save();

    const plan = await this.planModel.findById(task.planId);
    if (plan) {
      plan.nextDueDate = new Date(task.completedAt.getTime() + plan.frequencyMonths * 30 * MILLIS_PER_DAY);
      await plan.save();
    }

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: task.equipmentId.toString(),
      action: AuditAction.PM_TASK_COMPLETED,
      before: { status: PmTaskStatus.OPEN },
      after: { status: task.status, completionNote, nextDueDate: plan?.nextDueDate ?? null },
    });

    return toPmTaskData(task);
  }

  // EQP-3: the status card's PM due-date field — the active plan's nextDueDate, or null.
  async getNextDueDate(tenantId: string, equipmentId: string): Promise<string | null> {
    const plan = await this.planModel.findOne({ tenantId, equipmentId });
    return plan ? plan.nextDueDate.toISOString() : null;
  }

  // EQP-9 scanner support: every active plan in the tenant (the scanner itself decides due-ness).
  async listAllPlans(tenantId: string): Promise<PmPlanDocument[]> {
    return this.planModel.find({ tenantId });
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === MONGO_DUPLICATE_KEY;
}

function toPmPlanData(doc: PmPlanDocument): PmPlanData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    frequencyMonths: doc.frequencyMonths,
    checklistText: doc.checklistText,
    nextDueDate: doc.nextDueDate.toISOString(),
  };
}

function toPmTaskData(doc: PmTaskDocument): PmTaskData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    equipmentCode: doc.equipmentCode,
    equipmentName: doc.equipmentName,
    planId: doc.planId.toString(),
    status: doc.status,
    dueDate: doc.dueDate.toISOString(),
    completionNote: doc.completionNote,
    completedByUserId: doc.completedByUserId,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}
