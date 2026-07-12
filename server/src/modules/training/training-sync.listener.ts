import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DOCUMENT_TRAINING_TARGET_CHANGED_EVENT,
  USER_ROLE_ASSIGNED_EVENT,
  type DocumentTrainingTargetChangedEvent,
  type UserRoleAssignedEvent,
} from '@pharmaqms/shared';
import { TrainingService } from './training.service';

// TRN-1/TRN-3: reacts to Documents' (DOC-9 distribution edits + DOC-3/DOC-6 effective-version
// transitions) and PLT-8's (role/department assignment) events. Training never imports either
// module directly — see the schema comments on DocumentTrainingTarget for why.
@Injectable()
export class TrainingSyncListener {
  private readonly logger = new Logger(TrainingSyncListener.name);

  constructor(private readonly trainingService: TrainingService) {}

  @OnEvent(DOCUMENT_TRAINING_TARGET_CHANGED_EVENT)
  async handleTrainingTargetChanged(event: DocumentTrainingTargetChangedEvent): Promise<void> {
    try {
      await this.trainingService.upsertTrainingTarget(event);
    } catch (error) {
      this.logger.error(
        `Failed to sync training target for document ${event.documentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @OnEvent(USER_ROLE_ASSIGNED_EVENT)
  async handleUserRoleAssigned(event: UserRoleAssignedEvent): Promise<void> {
    try {
      await this.trainingService.syncAssignmentsForUser(event);
    } catch (error) {
      this.logger.error(
        `Failed to sync training assignments for user ${event.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
