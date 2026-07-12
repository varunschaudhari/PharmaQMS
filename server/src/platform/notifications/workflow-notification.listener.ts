import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  NotificationEvent,
  WORKFLOW_STEP_CHANGED_EVENT,
  WorkflowAction,
  WorkflowInstanceStatus,
  type WorkflowStepChangedEvent,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { NotificationsService } from './notifications.service';
import { approvedContent, rejectedContent, taskAssignedContent } from './workflow-notification-templates';

// PLT-6: subscribes to PLT-4's step-changed events and fans them out into the per-user
// notification log (SPEC.md §6.1 PLT-6 events: assigned, approved, rejected — due-soon/overdue
// come from the due-date scanner framework, not workflow events).
@Injectable()
export class WorkflowNotificationListener {
  private readonly logger = new Logger(WorkflowNotificationListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @OnEvent(WORKFLOW_STEP_CHANGED_EVENT)
  async handleStepChanged(event: WorkflowStepChangedEvent): Promise<void> {
    try {
      await this.mapEventToNotifications(event);
    } catch (error) {
      // A notification failure must never surface into the workflow action that emitted the
      // event — the audit trail, not the notification log, is the regulated record.
      this.logger.error(`Failed to create notifications for workflow event on ${event.entityType} ${event.entityId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  // Extracted (and public) so tests can assert the event -> notification mapping directly,
  // without racing the async event handler.
  async mapEventToNotifications(event: WorkflowStepChangedEvent): Promise<void> {
    const actor = { userId: event.actorId, fullName: event.actorFullName };

    // task_assigned: whoever now holds the ball. On reassign that is one specific user; on
    // submit/approve/reject-to-earlier-step it is everyone holding the now-current step's role.
    if (event.action === WorkflowAction.REASSIGN) {
      if (event.overrideAssigneeUserId && event.toStepName) {
        const content = taskAssignedContent(event.entityType, event.entityId, event.toStepName);
        await this.notificationsService.notify({
          tenantId: event.tenantId,
          userId: event.overrideAssigneeUserId,
          event: NotificationEvent.TASK_ASSIGNED,
          entityType: event.entityType,
          entityId: event.entityId,
          ...content,
          actor,
        });
      }
      return;
    }

    if (event.toStatus === WorkflowInstanceStatus.IN_PROGRESS && event.toStepRoleId && event.toStepName) {
      const assignees = await this.userModel.find({
        tenantId: event.tenantId,
        roleId: event.toStepRoleId,
        isActive: true,
      });
      const content = taskAssignedContent(event.entityType, event.entityId, event.toStepName);
      for (const assignee of assignees) {
        await this.notificationsService.notify({
          tenantId: event.tenantId,
          userId: assignee._id.toString(),
          event: NotificationEvent.TASK_ASSIGNED,
          entityType: event.entityType,
          entityId: event.entityId,
          ...content,
          actor,
        });
      }
    }

    // Outcome notifications route back to the author who submitted the instance.
    if (event.submittedByUserId) {
      if (event.action === WorkflowAction.APPROVE && event.toStatus === WorkflowInstanceStatus.APPROVED) {
        const content = approvedContent(event.entityType, event.entityId, event.actorFullName);
        await this.notificationsService.notify({
          tenantId: event.tenantId,
          userId: event.submittedByUserId,
          event: NotificationEvent.APPROVED,
          entityType: event.entityType,
          entityId: event.entityId,
          ...content,
          actor,
        });
      }

      if (event.action === WorkflowAction.REJECT) {
        const content = rejectedContent(event.entityType, event.entityId, event.actorFullName, event.comment);
        await this.notificationsService.notify({
          tenantId: event.tenantId,
          userId: event.submittedByUserId,
          event: NotificationEvent.REJECTED,
          entityType: event.entityType,
          entityId: event.entityId,
          ...content,
          actor,
        });
      }
    }
  }
}
