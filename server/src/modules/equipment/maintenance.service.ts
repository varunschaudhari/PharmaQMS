import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  MaintenanceTaskStatus,
  NotificationEvent,
  SignatureMeaning,
  type MaintenanceTaskData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../../platform/audit/audit.service';
import { User, UserDocument } from '../../platform/auth/schemas/user.schema';
import { EsignService } from '../../platform/esign/esign.service';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { Tenant, TenantDocument } from '../../platform/tenant/schemas/tenant.schema';
import {
  resolveMaintenanceRoleId,
  resolveRequireMaintenanceVerification,
} from '../../platform/tenant/tenant-settings.util';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { MaintenanceTask, MaintenanceTaskDocument } from './schemas/maintenance-task.schema';

export interface MaintenanceActor {
  userId: string;
  fullName: string;
}

// EQP-7: maintenance tasks are a sub-concern of the Equipment module (same relationship as
// EQP-4/5's CalibrationService to EquipmentService — see calibration.service.ts's header
// comment). LogbookService depends on this service directly to auto-create a task from a
// BREAKDOWN entry.
@Injectable()
export class MaintenanceService {
  constructor(
    @InjectModel(MaintenanceTask.name) private readonly taskModel: Model<MaintenanceTaskDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly auditService: AuditService,
    private readonly esignService: EsignService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // EQP-7: called by LogbookService immediately after a BREAKDOWN entry is created. Snapshots
  // the tenant's current maintenanceRoleId/requireMaintenanceVerification settings onto the task
  // so a later settings change never silently reinterprets an in-flight task.
  async createTaskFromBreakdown(
    tenantId: string,
    equipment: { id: string; equipmentCode: string; name: string },
    sourceLogbookEntryId: string,
    actor: MaintenanceActor,
  ): Promise<MaintenanceTaskData> {
    const tenant = await this.tenantModel.findById(tenantId);
    const assignedRoleId = resolveMaintenanceRoleId(tenant);
    const verificationRequired = resolveRequireMaintenanceVerification(tenant);

    const task = await this.taskModel.create({
      tenantId,
      equipmentId: equipment.id,
      equipmentCode: equipment.equipmentCode,
      equipmentName: equipment.name,
      sourceLogbookEntryId,
      status: MaintenanceTaskStatus.OPEN,
      assignedRoleId,
      verificationRequired,
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipment.id,
      action: AuditAction.MAINTENANCE_TASK_CREATED,
      before: null,
      after: { equipmentCode: equipment.equipmentCode, assignedRoleId, verificationRequired },
    });

    if (assignedRoleId) {
      const assignees = await this.userModel.find({ tenantId, roleId: assignedRoleId, isActive: true });
      for (const assignee of assignees) {
        await this.notificationsService.notify({
          tenantId,
          userId: assignee._id.toString(),
          event: NotificationEvent.TASK_ASSIGNED,
          entityType: EQUIPMENT_ENTITY_TYPE,
          entityId: equipment.id,
          title: `Maintenance task: ${equipment.equipmentCode}`,
          body: `A breakdown was reported for ${equipment.equipmentCode} — ${equipment.name}. Please investigate.`,
          actor,
        });
      }
    }

    return toMaintenanceTaskData(task);
  }

  async listForEquipment(tenantId: string, equipmentId: string): Promise<MaintenanceTaskData[]> {
    const tasks = await this.taskModel.find({ tenantId, equipmentId }).sort({ createdAt: -1 });
    return tasks.map(toMaintenanceTaskData);
  }

  // EQP-7: QA-facing maintenance queue — every task not yet fully closed.
  async listOpen(tenantId: string): Promise<MaintenanceTaskData[]> {
    const tasks = await this.taskModel
      .find({ tenantId, status: { $in: [MaintenanceTaskStatus.OPEN, MaintenanceTaskStatus.PENDING_VERIFICATION] } })
      .sort({ createdAt: 1 });
    return tasks.map(toMaintenanceTaskData);
  }

  // EQP-7: engineer completion. Moves to PENDING_VERIFICATION if the tenant requires a
  // QA/user verification sign-off (snapshotted at creation), else straight to CLOSED.
  async close(
    tenantId: string,
    taskId: string,
    actor: MaintenanceActor,
    completionNote: string,
  ): Promise<MaintenanceTaskData> {
    const task = await this.findOrThrow(tenantId, taskId);
    if (task.status !== MaintenanceTaskStatus.OPEN) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'This maintenance task has already been closed.', HttpStatus.BAD_REQUEST);
    }

    task.engineerCompletionNote = completionNote;
    task.completedByUserId = actor.userId;
    task.completedAt = new Date();
    task.status = task.verificationRequired ? MaintenanceTaskStatus.PENDING_VERIFICATION : MaintenanceTaskStatus.CLOSED;
    await task.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: task.equipmentId.toString(),
      action: AuditAction.MAINTENANCE_TASK_CLOSED,
      before: { status: MaintenanceTaskStatus.OPEN },
      after: { status: task.status, completionNote },
    });

    return toMaintenanceTaskData(task);
  }

  // EQP-7 / Iron Rule 4: verification IS an e-signature — SignatureGuard enforces a fresh
  // credential. Only applicable when the task actually requires verification.
  async verify(
    tenantId: string,
    taskId: string,
    signer: SigningContext,
    note: string | null,
  ): Promise<MaintenanceTaskData> {
    const task = await this.findOrThrow(tenantId, taskId);
    if (task.status !== MaintenanceTaskStatus.PENDING_VERIFICATION) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'This maintenance task is not awaiting verification.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.VERIFIED_BY,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: task.equipmentId.toString(),
      entitySnapshot: { taskId: task._id.toString(), completionNote: task.engineerCompletionNote },
      reason: note,
    });

    task.verifiedByUserId = signer.userId;
    task.verifiedAt = new Date();
    task.verificationNote = note;
    task.status = MaintenanceTaskStatus.CLOSED;
    await task.save();

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: task.equipmentId.toString(),
      action: AuditAction.MAINTENANCE_TASK_VERIFIED,
      before: { status: MaintenanceTaskStatus.PENDING_VERIFICATION },
      after: { status: task.status },
    });

    return toMaintenanceTaskData(task);
  }

  private async findOrThrow(tenantId: string, taskId: string): Promise<MaintenanceTaskDocument> {
    const task = await this.taskModel.findOne({ _id: taskId, tenantId });
    if (!task) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Maintenance task not found.', HttpStatus.NOT_FOUND);
    }
    return task;
  }
}

function toMaintenanceTaskData(doc: MaintenanceTaskDocument): MaintenanceTaskData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    equipmentCode: doc.equipmentCode,
    equipmentName: doc.equipmentName,
    sourceLogbookEntryId: doc.sourceLogbookEntryId.toString(),
    status: doc.status,
    assignedRoleId: doc.assignedRoleId ? doc.assignedRoleId.toString() : null,
    engineerCompletionNote: doc.engineerCompletionNote,
    completedByUserId: doc.completedByUserId,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    verificationRequired: doc.verificationRequired,
    verifiedByUserId: doc.verifiedByUserId,
    verifiedAt: doc.verifiedAt ? doc.verifiedAt.toISOString() : null,
    verificationNote: doc.verificationNote,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}
