import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DocumentVersionState,
  WORKFLOW_STEP_CHANGED_EVENT,
  WorkflowAction,
  WorkflowInstanceStatus,
  type WorkflowStepChangedEvent,
} from '@pharmaqms/shared';
import { DOCUMENT_VERSION_ENTITY_TYPE } from './document-entity-types';
import { DocumentsService } from './documents.service';

// DOC-3: the PLT-4 workflow is the approval authority; this listener keeps the version's
// lifecycle state in sync with workflow progress. Every sync goes through
// DocumentsService.transitionVersion(), so the shared transition map still guards each move
// and each state change is audited with the workflow comment as its reason.
@Injectable()
export class DocumentWorkflowListener {
  private readonly logger = new Logger(DocumentWorkflowListener.name);

  constructor(private readonly documentsService: DocumentsService) {}

  @OnEvent(WORKFLOW_STEP_CHANGED_EVENT)
  async handleStepChanged(event: WorkflowStepChangedEvent): Promise<void> {
    if (event.entityType !== DOCUMENT_VERSION_ENTITY_TYPE) {
      return;
    }
    try {
      await this.syncVersionState(event);
    } catch (error) {
      this.logger.error(
        `Failed to sync document version ${event.entityId} with workflow event (${event.action})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async syncVersionState(event: WorkflowStepChangedEvent): Promise<void> {
    const tenantId = event.tenantId;
    const versionId = event.entityId;
    const actor = { userId: event.actorId, fullName: event.actorFullName };

    if (event.action === WorkflowAction.APPROVE && event.toStatus === WorkflowInstanceStatus.APPROVED) {
      // Final approval → Effective (DOC-2 auto-supersede happens inside the service). A 1-step
      // template approves straight from review — pass through under_approval so the transition
      // map is honoured (both hops audited).
      const version = await this.documentsService.findVersionOrThrow(tenantId, versionId);
      if (version.state === DocumentVersionState.UNDER_REVIEW) {
        await this.documentsService.transitionVersion(tenantId, versionId, DocumentVersionState.UNDER_APPROVAL, actor, null);
      }
      await this.documentsService.transitionVersion(
        tenantId,
        versionId,
        DocumentVersionState.EFFECTIVE,
        actor,
        event.comment,
      );
      return;
    }

    if (event.action === WorkflowAction.APPROVE && event.toStatus === WorkflowInstanceStatus.IN_PROGRESS) {
      // Moved past the review step into approval.
      const version = await this.documentsService.findVersionOrThrow(tenantId, versionId);
      if (version.state === DocumentVersionState.UNDER_REVIEW) {
        await this.documentsService.transitionVersion(
          tenantId,
          versionId,
          DocumentVersionState.UNDER_APPROVAL,
          actor,
          event.comment,
        );
      }
      return;
    }

    if (event.action === WorkflowAction.REJECT) {
      const target =
        event.toStatus === WorkflowInstanceStatus.DRAFT
          ? DocumentVersionState.DRAFT
          : DocumentVersionState.UNDER_REVIEW;
      await this.documentsService.transitionVersion(tenantId, versionId, target, actor, event.comment);
    }
  }
}
