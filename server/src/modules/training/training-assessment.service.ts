import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  assertTrainingAssessmentStatusTransition,
  AuditAction,
  ErrorCode,
  NotificationEvent,
  TrainingAssessmentStatus,
  type SubmitTrainingAssessmentAttemptRequest,
  type TrainingAssessmentAttemptResultData,
  type TrainingAssessmentData,
  type TrainingAssessmentForTraineeData,
  type TrainingAssignmentAssessmentSummary,
  type UpsertTrainingAssessmentRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../../platform/audit/audit.service';
import { User, UserDocument } from '../../platform/auth/schemas/user.schema';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument } from '../../platform/tenant/schemas/tenant.schema';
import {
  resolveTrainingAssessmentMaxAttempts,
  resolveTrainingAssessmentPassMarkPercentage,
} from '../../platform/tenant/tenant-settings.util';
import { TRAINING_ASSESSMENT_ENTITY_TYPE, TRAINING_ASSIGNMENT_ENTITY_TYPE } from './training-entity-types';
import { TrainingAssessment, TrainingAssessmentDocument } from './schemas/training-assessment.schema';
import { TrainingAssessmentAttempt, TrainingAssessmentAttemptDocument } from './schemas/training-assessment-attempt.schema';
import { TrainingAssignment, TrainingAssignmentDocument } from './schemas/training-assignment.schema';

export interface TrainingAssessmentActor {
  userId: string;
  fullName: string;
}

// TRN-6 (SPEC.md §7.2): the assessment (question bank) sub-concern of the Training module —
// injects the raw TrainingAssignment model directly (not TrainingService) so TrainingService can
// depend on THIS service without a circular dependency, same "model-only injection" precedent as
// CalibrationService/RoomCleaningService depending on their sibling top-level services.
@Injectable()
export class TrainingAssessmentService {
  constructor(
    @InjectModel(TrainingAssessment.name) private readonly assessmentModel: Model<TrainingAssessmentDocument>,
    @InjectModel(TrainingAssessmentAttempt.name) private readonly attemptModel: Model<TrainingAssessmentAttemptDocument>,
    @InjectModel(TrainingAssignment.name) private readonly assignmentModel: Model<TrainingAssignmentDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // TRN-6 (a): QA authors/edits the whole question bank in one call. Editing an already-Approved
  // assessment resets it to Draft — a changed answer key must be re-reviewed before trainees see it.
  async upsertAssessment(
    tenantId: string,
    documentId: string,
    versionId: string,
    actor: TrainingAssessmentActor,
    dto: UpsertTrainingAssessmentRequest,
  ): Promise<TrainingAssessmentData> {
    const existing = await this.assessmentModel.findOne({ tenantId, versionId });
    const before = existing ? { status: existing.status, questionCount: existing.questions.length } : null;

    const assessment =
      existing ??
      new this.assessmentModel({
        tenantId,
        documentId,
        versionId,
        docNumber: dto.docNumber,
        versionLabel: dto.versionLabel,
        createdByUserId: actor.userId,
      });
    assessment.questions = dto.questions.map((q) => ({
      questionText: q.questionText,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
    })) as typeof assessment.questions;
    assessment.status = TrainingAssessmentStatus.DRAFT;
    assessment.approvedByUserId = null;
    assessment.approvedAt = null;
    await assessment.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: TRAINING_ASSESSMENT_ENTITY_TYPE,
      entityId: assessment._id.toString(),
      action: AuditAction.TRAINING_ASSESSMENT_UPSERTED,
      before,
      after: { status: assessment.status, questionCount: assessment.questions.length },
    });

    return toAssessmentData(assessment);
  }

  // TRN-6 (a): the explicit QA review step — Draft -> Approved, never settable directly.
  async approveAssessment(tenantId: string, versionId: string, actor: TrainingAssessmentActor): Promise<TrainingAssessmentData> {
    const assessment = await this.findByVersionOrThrow(tenantId, versionId);
    try {
      assertTrainingAssessmentStatusTransition(assessment.status, TrainingAssessmentStatus.APPROVED);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid assessment status transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    assessment.status = TrainingAssessmentStatus.APPROVED;
    assessment.approvedByUserId = actor.userId;
    assessment.approvedAt = new Date();
    await assessment.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: TRAINING_ASSESSMENT_ENTITY_TYPE,
      entityId: assessment._id.toString(),
      action: AuditAction.TRAINING_ASSESSMENT_APPROVED,
      before: { status: TrainingAssessmentStatus.DRAFT },
      after: { status: assessment.status },
    });

    return toAssessmentData(assessment);
  }

  async getForAuthoring(tenantId: string, versionId: string): Promise<TrainingAssessmentData | null> {
    const assessment = await this.assessmentModel.findOne({ tenantId, versionId });
    return assessment ? toAssessmentData(assessment) : null;
  }

  // TRN-6 (c): the trainee-facing view — randomized order, no answer key.
  async getForTrainee(tenantId: string, assignmentId: string, requestingUserId: string): Promise<TrainingAssessmentForTraineeData | null> {
    const assignment = await this.findAssignmentOrThrow(tenantId, assignmentId, requestingUserId);
    const assessment = await this.assessmentModel.findOne({
      tenantId,
      versionId: assignment.versionId,
      status: TrainingAssessmentStatus.APPROVED,
    });
    if (!assessment) {
      return null;
    }

    const tenant = await this.tenantModel.findById(tenantId);
    const questions = shuffle(
      assessment.questions.map((q) => ({ id: q._id.toString(), questionText: q.questionText, options: q.options })),
    );

    return {
      assessmentId: assessment._id.toString(),
      passMarkPercentage: resolveTrainingAssessmentPassMarkPercentage(tenant),
      questions,
    };
  }

  // TRN-6 (c): immediate scoring — one immutable attempt per submission (audited). Fail notifies
  // the trainee + department head is escalated only once max attempts is reached.
  async submitAttempt(
    tenantId: string,
    assignmentId: string,
    actor: TrainingAssessmentActor,
    dto: SubmitTrainingAssessmentAttemptRequest,
  ): Promise<TrainingAssessmentAttemptResultData> {
    const assignment = await this.findAssignmentOrThrow(tenantId, assignmentId, actor.userId);
    const assessment = await this.assessmentModel.findOne({
      tenantId,
      versionId: assignment.versionId,
      status: TrainingAssessmentStatus.APPROVED,
    });
    if (!assessment) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No assessment is configured for this document version.', HttpStatus.NOT_FOUND);
    }

    const tenant = await this.tenantModel.findById(tenantId);
    const maxAttempts = resolveTrainingAssessmentMaxAttempts(tenant);
    const passMarkPercentage = resolveTrainingAssessmentPassMarkPercentage(tenant);

    const priorAttempts = await this.attemptModel.countDocuments({ tenantId, assignmentId });
    if (priorAttempts >= maxAttempts) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Maximum assessment attempts reached — contact your department head.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const answerByQuestionId = new Map(dto.answers.map((a) => [a.questionId, a.selectedOptionIndex]));
    const correctCount = assessment.questions.filter((q) => answerByQuestionId.get(q._id.toString()) === q.correctOptionIndex).length;
    const scorePercentage = Math.round((correctCount / assessment.questions.length) * 100);
    const passed = scorePercentage >= passMarkPercentage;
    const attemptNumber = priorAttempts + 1;

    const attempt = await this.attemptModel.create({
      tenantId,
      assignmentId,
      assessmentId: assessment._id,
      userId: actor.userId,
      attemptNumber,
      answers: dto.answers,
      scorePercentage,
      passed,
      occurredAt: new Date(),
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: assignmentId,
      action: AuditAction.TRAINING_ASSESSMENT_ATTEMPTED,
      before: null,
      after: { attemptNumber, scorePercentage, passed },
    });

    const maxAttemptsReached = attemptNumber >= maxAttempts;
    if (!passed) {
      await this.notifyTraineeOfFailure(tenantId, assignment, attemptNumber, maxAttempts, actor);
      if (maxAttemptsReached) {
        await this.escalateToDepartmentHead(tenantId, assignment, actor);
      }
    }

    return {
      attempt: toAttemptData(attempt),
      attemptsRemaining: Math.max(0, maxAttempts - attemptNumber),
      maxAttemptsReached,
    };
  }

  async hasPassingAttempt(tenantId: string, assignmentId: string): Promise<boolean> {
    const passing = await this.attemptModel.findOne({ tenantId, assignmentId, passed: true });
    return Boolean(passing);
  }

  // TRN-6: whether this version even HAS a usable (Approved) assessment — the gate
  // TrainingService.completeAssignment uses to decide if a quiz is required at all.
  async hasApprovedAssessment(tenantId: string, versionId: string): Promise<boolean> {
    const assessment = await this.assessmentModel.findOne({ tenantId, versionId, status: TrainingAssessmentStatus.APPROVED });
    return Boolean(assessment);
  }

  // TRN-6: batched summary lookup for TrainingService's listForUser/listOverdue/completeAssignment
  // — avoids an N+1 async call per assignment inside a plain .map().
  async getAssignmentAssessmentSummaries(
    tenantId: string,
    assignments: Array<{ id: string; versionId: string }>,
  ): Promise<Map<string, TrainingAssignmentAssessmentSummary>> {
    const result = new Map<string, TrainingAssignmentAssessmentSummary>();
    if (assignments.length === 0) {
      return result;
    }

    const versionIds = [...new Set(assignments.map((a) => a.versionId))];
    const assessments = await this.assessmentModel.find({
      tenantId,
      versionId: { $in: versionIds },
      status: TrainingAssessmentStatus.APPROVED,
    });
    if (assessments.length === 0) {
      return result;
    }
    const assessmentByVersionId = new Map(assessments.map((a) => [a.versionId, a]));

    const tenant = await this.tenantModel.findById(tenantId);
    const maxAttempts = resolveTrainingAssessmentMaxAttempts(tenant);

    const relevantAssignmentIds = assignments.filter((a) => assessmentByVersionId.has(a.versionId)).map((a) => a.id);
    const attempts = await this.attemptModel.find({ tenantId, assignmentId: { $in: relevantAssignmentIds } });
    const attemptsByAssignment = new Map<string, TrainingAssessmentAttemptDocument[]>();
    for (const attempt of attempts) {
      const key = attempt.assignmentId.toString();
      const list = attemptsByAssignment.get(key) ?? [];
      list.push(attempt);
      attemptsByAssignment.set(key, list);
    }

    for (const assignment of assignments) {
      const assessment = assessmentByVersionId.get(assignment.versionId);
      if (!assessment) continue;
      const attemptsForAssignment = attemptsByAssignment.get(assignment.id) ?? [];
      const bestScorePercentage =
        attemptsForAssignment.length > 0 ? Math.max(...attemptsForAssignment.map((a) => a.scorePercentage)) : null;
      const passed = attemptsForAssignment.some((a) => a.passed);
      result.set(assignment.id, {
        assessmentId: assessment._id.toString(),
        attemptCount: attemptsForAssignment.length,
        bestScorePercentage,
        passed,
        maxAttemptsReached: !passed && attemptsForAssignment.length >= maxAttempts,
      });
    }
    return result;
  }

  // TRN-6: QA-dashboard/matrix aggregate — how much assessment activity a document has seen.
  async getMatrixAssessmentStats(tenantId: string, documentId: string): Promise<{ totalAssessmentAttempts: number; totalAssessmentFailedMaxAttempts: number }> {
    const assessments = await this.assessmentModel.find({ tenantId, documentId });
    if (assessments.length === 0) {
      return { totalAssessmentAttempts: 0, totalAssessmentFailedMaxAttempts: 0 };
    }
    const assessmentIds = assessments.map((a) => a._id);
    const attempts = await this.attemptModel.find({ tenantId, assessmentId: { $in: assessmentIds } });
    const tenant = await this.tenantModel.findById(tenantId);
    const maxAttempts = resolveTrainingAssessmentMaxAttempts(tenant);

    const attemptsByAssignment = new Map<string, TrainingAssessmentAttemptDocument[]>();
    for (const attempt of attempts) {
      const key = attempt.assignmentId.toString();
      const list = attemptsByAssignment.get(key) ?? [];
      list.push(attempt);
      attemptsByAssignment.set(key, list);
    }
    let totalAssessmentFailedMaxAttempts = 0;
    for (const list of attemptsByAssignment.values()) {
      if (list.length >= maxAttempts && !list.some((a) => a.passed)) {
        totalAssessmentFailedMaxAttempts += 1;
      }
    }
    return { totalAssessmentAttempts: attempts.length, totalAssessmentFailedMaxAttempts };
  }

  // TRN-6 (a): "a new document version carries forward questions with an explicit QA review
  // step" — called from TrainingService.upsertTrainingTarget whenever the Effective version
  // changes. The copy is created DRAFT (never auto-approved), so the carried-forward questions
  // are unusable by trainees until QA re-reviews and approves them for the new version.
  async carryForwardAssessment(
    tenantId: string,
    documentId: string,
    fromVersionId: string,
    toVersionId: string,
    toVersionLabel: string,
    docNumber: string,
  ): Promise<void> {
    const source = await this.assessmentModel.findOne({ tenantId, versionId: fromVersionId });
    if (!source) {
      return; // The prior version had no assessment — nothing to carry forward.
    }
    const alreadyExists = await this.assessmentModel.findOne({ tenantId, versionId: toVersionId });
    if (alreadyExists) {
      return; // Idempotent — a concurrent/duplicate event must not re-clone.
    }

    const copy = await this.assessmentModel.create({
      tenantId,
      documentId,
      versionId: toVersionId,
      docNumber,
      versionLabel: toVersionLabel,
      status: TrainingAssessmentStatus.DRAFT,
      questions: source.questions.map((q) => ({ questionText: q.questionText, options: q.options, correctOptionIndex: q.correctOptionIndex })),
      createdByUserId: null, // system-generated carry-forward, not a human edit
    });

    await this.auditService.record({
      tenantId,
      actor: null,
      entityType: TRAINING_ASSESSMENT_ENTITY_TYPE,
      entityId: copy._id.toString(),
      action: AuditAction.TRAINING_ASSESSMENT_UPSERTED,
      before: null,
      after: { status: copy.status, questionCount: copy.questions.length },
      reason: `Carried forward from the prior version's assessment (${fromVersionId}) — requires QA re-approval.`,
    });
  }

  private async findByVersionOrThrow(tenantId: string, versionId: string): Promise<TrainingAssessmentDocument> {
    const assessment = await this.assessmentModel.findOne({ tenantId, versionId });
    if (!assessment) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No assessment is configured for this document version.', HttpStatus.NOT_FOUND);
    }
    return assessment;
  }

  private async findAssignmentOrThrow(tenantId: string, assignmentId: string, requestingUserId: string): Promise<TrainingAssignmentDocument> {
    const assignment = await this.assignmentModel.findOne({ _id: assignmentId, tenantId });
    if (!assignment) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Training assignment not found.', HttpStatus.NOT_FOUND);
    }
    if (assignment.userId !== requestingUserId) {
      throw new AppException(ErrorCode.PERMISSION_DENIED, 'You can only access your own training assignments.', HttpStatus.FORBIDDEN);
    }
    return assignment;
  }

  private async notifyTraineeOfFailure(
    tenantId: string,
    assignment: TrainingAssignmentDocument,
    attemptNumber: number,
    maxAttempts: number,
    actor: TrainingAssessmentActor,
  ): Promise<void> {
    const remaining = Math.max(0, maxAttempts - attemptNumber);
    await this.notificationsService.notify({
      tenantId,
      userId: assignment.userId,
      event: NotificationEvent.REJECTED,
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: assignment._id.toString(),
      title: `Assessment failed: ${assignment.docNumber}`,
      body:
        remaining > 0
          ? `Attempt ${attemptNumber} did not meet the pass mark for ${assignment.docNumber} — ${assignment.documentTitle}. ${remaining} attempt(s) remaining.`
          : `Attempt ${attemptNumber} did not meet the pass mark for ${assignment.docNumber} — ${assignment.documentTitle}. No attempts remain — your department head has been notified.`,
      actor,
    });
  }

  private async escalateToDepartmentHead(
    tenantId: string,
    assignment: TrainingAssignmentDocument,
    actor: TrainingAssessmentActor,
  ): Promise<void> {
    const user = await this.userModel.findOne({ _id: assignment.userId, tenantId });
    if (!user?.departmentId) {
      return; // No department on file — nobody to escalate to.
    }
    const department = await this.departmentModel.findOne({ _id: user.departmentId, tenantId });
    if (!department?.headUserId) {
      return; // Silent skip — same "no configured recipient" precedent as every other scanner/notifier.
    }

    await this.notificationsService.notify({
      tenantId,
      userId: department.headUserId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: assignment._id.toString(),
      title: `Assessment escalation: ${assignment.docNumber}`,
      body: `${user.fullName} has exhausted all assessment attempts for ${assignment.docNumber} — ${assignment.documentTitle}. Please arrange retraining.`,
      actor,
    });
  }
}

function toAssessmentData(doc: TrainingAssessmentDocument): TrainingAssessmentData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    documentId: doc.documentId,
    versionId: doc.versionId,
    docNumber: doc.docNumber,
    versionLabel: doc.versionLabel,
    status: doc.status,
    questions: doc.questions.map((q) => ({
      id: q._id.toString(),
      questionText: q.questionText,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
    })),
    createdByUserId: doc.createdByUserId,
    approvedByUserId: doc.approvedByUserId,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

function toAttemptData(doc: TrainingAssessmentAttemptDocument) {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    assignmentId: doc.assignmentId.toString(),
    assessmentId: doc.assessmentId.toString(),
    userId: doc.userId,
    attemptNumber: doc.attemptNumber,
    answers: doc.answers.map((a) => ({ questionId: a.questionId, selectedOptionIndex: a.selectedOptionIndex })),
    scorePercentage: doc.scorePercentage,
    passed: doc.passed,
    occurredAt: doc.occurredAt.toISOString(),
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
