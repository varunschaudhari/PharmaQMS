import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  SignatureMeaning,
  TrainingAssignmentStatus,
  type DocumentTrainingTargetChangedEvent,
  type TrainingAssignmentData,
  type TrainingMatrixEntryData,
  type UserRoleAssignedEvent,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PdfRenderService } from '../../common/pdf/pdf-render.service';
import { AuditService } from '../../platform/audit/audit.service';
import { User, UserDocument } from '../../platform/auth/schemas/user.schema';
import { EsignService } from '../../platform/esign/esign.service';
import { resolveTrainingGracePeriodDays } from '../../platform/tenant/tenant-settings.util';
import { Tenant, TenantDocument } from '../../platform/tenant/schemas/tenant.schema';
import { employeeRecordHtml } from './employee-record-html';
import {
  DocumentTrainingTarget,
  DocumentTrainingTargetDocument,
} from './schemas/document-training-target.schema';
import { TrainingAssignment, TrainingAssignmentDocument } from './schemas/training-assignment.schema';
import { TRAINING_ASSIGNMENT_ENTITY_TYPE } from './training-entity-types';

const MONGO_DUPLICATE_KEY = 11000;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(TrainingAssignment.name) private readonly assignmentModel: Model<TrainingAssignmentDocument>,
    @InjectModel(DocumentTrainingTarget.name) private readonly targetModel: Model<DocumentTrainingTargetDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    private readonly auditService: AuditService,
    private readonly esignService: EsignService,
    private readonly pdfRenderService: PdfRenderService,
  ) {}

  // DOC-9/TRN-3: mirror the latest snapshot, then (re)assign for every currently-mapped user.
  async upsertTrainingTarget(event: DocumentTrainingTargetChangedEvent): Promise<void> {
    const target = await this.targetModel.findOneAndUpdate(
      { tenantId: event.tenantId, documentId: event.documentId },
      {
        $set: {
          docNumber: event.docNumber,
          title: event.title,
          effectiveVersionId: event.effectiveVersionId,
          effectiveVersionLabel: event.effectiveVersionLabel,
          distributionRoleIds: event.distributionRoleIds,
          distributionDepartmentIds: event.distributionDepartmentIds,
        },
      },
      { upsert: true, new: true },
    );

    if (!target.effectiveVersionId) {
      return; // Distribution configured, but nothing Effective yet — nothing to assign.
    }

    const matchQuery = this.buildUserMatchQuery(
      event.tenantId,
      target.distributionRoleIds,
      target.distributionDepartmentIds,
    );
    if (!matchQuery) {
      return;
    }
    const users = await this.userModel.find(matchQuery);
    for (const user of users) {
      await this.ensureAssignment(event.tenantId, user._id.toString(), target);
    }
  }

  // TRN-1: "adding a user to a role auto-generates their pending training items" — the reverse
  // direction, driven off the LOCAL mirror (never a live Documents query).
  async syncAssignmentsForUser(event: UserRoleAssignedEvent): Promise<void> {
    const conditions: Record<string, unknown>[] = [{ distributionRoleIds: event.roleId }];
    if (event.departmentId) {
      conditions.push({ distributionDepartmentIds: event.departmentId });
    }
    const targets = await this.targetModel.find({
      tenantId: event.tenantId,
      effectiveVersionId: { $ne: null },
      $or: conditions,
    });
    for (const target of targets) {
      await this.ensureAssignment(event.tenantId, event.userId, target);
    }
  }

  // TRN-2: employee e-signs "Trained — read and understood" (PLT-3) to close their own task.
  async completeAssignment(
    tenantId: string,
    signer: SigningContext,
    assignmentId: string,
  ): Promise<TrainingAssignmentData> {
    const assignment = await this.assignmentModel.findOne({ _id: assignmentId, tenantId });
    if (!assignment) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Training assignment not found.', HttpStatus.NOT_FOUND);
    }
    if (assignment.userId !== signer.userId) {
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        'You can only complete your own training assignments.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (assignment.status !== TrainingAssignmentStatus.PENDING) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'This training assignment has already been completed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.TRAINED_READ_AND_UNDERSTOOD,
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: assignment._id.toString(),
      entitySnapshot: { docNumber: assignment.docNumber, versionLabel: assignment.versionLabel },
      reason: null,
    });

    assignment.status = TrainingAssignmentStatus.COMPLETED;
    assignment.completedAt = new Date();
    await assignment.save();

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: assignment._id.toString(),
      action: AuditAction.TRAINING_COMPLETED,
      before: { status: TrainingAssignmentStatus.PENDING },
      after: { status: TrainingAssignmentStatus.COMPLETED, docNumber: assignment.docNumber, versionLabel: assignment.versionLabel },
    });

    const user = await this.userModel.findOne({ _id: signer.userId, tenantId });
    const tenant = await this.tenantModel.findById(tenantId);
    return this.toAssignmentData(assignment, resolveTrainingGracePeriodDays(tenant), user?.fullName ?? signer.fullName);
  }

  async listForUser(tenantId: string, userId: string): Promise<TrainingAssignmentData[]> {
    const [assignments, tenant, user] = await Promise.all([
      this.assignmentModel.find({ tenantId, userId }).sort({ assignedAt: -1 }),
      this.tenantModel.findById(tenantId),
      this.userModel.findOne({ _id: userId, tenantId }),
    ]);
    if (!user) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found.', HttpStatus.NOT_FOUND);
    }
    const gracePeriodDays = resolveTrainingGracePeriodDays(tenant);
    return assignments.map((a) => this.toAssignmentData(a, gracePeriodDays, user.fullName));
  }

  // TRN-1: admin overview — role/department × document mapping (DOC-9), with live completion
  // counts. The mapping itself is edited on the document; this is read-only.
  async getMatrix(tenantId: string): Promise<TrainingMatrixEntryData[]> {
    const targets = await this.targetModel.find({ tenantId }).sort({ docNumber: 1 });
    const tenant = await this.tenantModel.findById(tenantId);
    const gracePeriodDays = resolveTrainingGracePeriodDays(tenant);
    const now = new Date();

    const results: TrainingMatrixEntryData[] = [];
    for (const target of targets) {
      const assignments = await this.assignmentModel.find({ tenantId, documentId: target.documentId });
      const totalCompleted = assignments.filter((a) => a.status === TrainingAssignmentStatus.COMPLETED).length;
      const totalOverdue = assignments.filter(
        (a) => a.status === TrainingAssignmentStatus.PENDING && this.isOverdue(a.assignedAt, gracePeriodDays, now),
      ).length;
      results.push({
        documentId: target.documentId,
        docNumber: target.docNumber,
        title: target.title,
        distributionRoleIds: target.distributionRoleIds,
        distributionDepartmentIds: target.distributionDepartmentIds,
        hasEffectiveVersion: target.effectiveVersionId !== null,
        totalAssigned: assignments.length,
        totalCompleted,
        totalOverdue,
      });
    }
    return results;
  }

  // TRN-5: dashboard feed + the due-date scanner's data source.
  async listOverdue(tenantId: string, now: Date = new Date()): Promise<TrainingAssignmentData[]> {
    const [pending, tenant] = await Promise.all([
      this.assignmentModel.find({ tenantId, status: TrainingAssignmentStatus.PENDING }),
      this.tenantModel.findById(tenantId),
    ]);
    const gracePeriodDays = resolveTrainingGracePeriodDays(tenant);
    const overdue = pending.filter((a) => this.isOverdue(a.assignedAt, gracePeriodDays, now));
    if (overdue.length === 0) {
      return [];
    }

    const userIds = [...new Set(overdue.map((a) => a.userId))];
    const users = await this.userModel.find({ tenantId, _id: { $in: userIds } });
    const nameById = new Map(users.map((u) => [u._id.toString(), u.fullName]));

    return overdue
      .map((a) => this.toAssignmentData(a, gracePeriodDays, nameById.get(a.userId) ?? 'Unknown', now))
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  }

  async generateEmployeeRecordPdf(tenantId: string, userId: string): Promise<Buffer> {
    const assignments = await this.listForUser(tenantId, userId);
    const user = await this.userModel.findOne({ _id: userId, tenantId });
    if (!user) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found.', HttpStatus.NOT_FOUND);
    }
    const html = employeeRecordHtml(user.fullName, assignments);
    return this.pdfRenderService.render(html, { preferCSSPageSize: true });
  }

  // Retargets an open PENDING task in place (TRN-3 retraining) or creates a fresh one — never
  // duplicates. Also skips silently if this exact version was already completed (defends
  // against duplicate event delivery re-creating a redundant task).
  private async ensureAssignment(
    tenantId: string,
    userId: string,
    target: DocumentTrainingTargetDocument,
  ): Promise<void> {
    if (!target.effectiveVersionId) {
      return;
    }

    const user = await this.userModel.findOne({ _id: userId, tenantId, isActive: true });
    if (!user) {
      return; // Deactivated/removed since the triggering event fired.
    }

    const existingPending = await this.assignmentModel.findOne({
      tenantId,
      userId,
      documentId: target.documentId,
      status: TrainingAssignmentStatus.PENDING,
    });

    if (existingPending) {
      if (existingPending.versionId === target.effectiveVersionId) {
        return; // Already up to date.
      }
      const before = { versionId: existingPending.versionId, versionLabel: existingPending.versionLabel };
      existingPending.versionId = target.effectiveVersionId;
      existingPending.versionLabel = target.effectiveVersionLabel ?? existingPending.versionLabel;
      existingPending.assignedAt = new Date();
      await existingPending.save();
      await this.auditService.record({
        tenantId,
        actor: null, // system-generated (new Effective version, not a human action)
        entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
        entityId: existingPending._id.toString(),
        action: AuditAction.TRAINING_ASSIGNED,
        before,
        after: { versionId: target.effectiveVersionId, versionLabel: target.effectiveVersionLabel },
        reason: 'Retraining required: a new Effective version was issued.',
      });
      return;
    }

    const alreadyCompletedThisVersion = await this.assignmentModel.findOne({
      tenantId,
      userId,
      documentId: target.documentId,
      versionId: target.effectiveVersionId,
      status: TrainingAssignmentStatus.COMPLETED,
    });
    if (alreadyCompletedThisVersion) {
      return;
    }

    let created: TrainingAssignmentDocument;
    try {
      created = await this.assignmentModel.create({
        tenantId,
        userId,
        documentId: target.documentId,
        docNumber: target.docNumber,
        documentTitle: target.title,
        versionId: target.effectiveVersionId,
        versionLabel: target.effectiveVersionLabel,
        status: TrainingAssignmentStatus.PENDING,
        assignedAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return; // A concurrent sync already created the pending row.
      }
      throw error;
    }

    await this.auditService.record({
      tenantId,
      actor: null,
      entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
      entityId: created._id.toString(),
      action: AuditAction.TRAINING_ASSIGNED,
      before: null,
      after: { userId, docNumber: target.docNumber, versionLabel: target.effectiveVersionLabel },
    });
  }

  private buildUserMatchQuery(
    tenantId: string,
    roleIds: string[],
    departmentIds: string[],
  ): Record<string, unknown> | null {
    const conditions: Record<string, unknown>[] = [];
    if (roleIds.length > 0) conditions.push({ roleId: { $in: roleIds } });
    if (departmentIds.length > 0) conditions.push({ departmentId: { $in: departmentIds } });
    if (conditions.length === 0) {
      return null;
    }
    return { tenantId, isActive: true, $or: conditions };
  }

  private computeDueDate(assignedAt: Date, gracePeriodDays: number): Date {
    return new Date(assignedAt.getTime() + gracePeriodDays * MILLIS_PER_DAY);
  }

  private isOverdue(assignedAt: Date, gracePeriodDays: number, now: Date): boolean {
    return this.computeDueDate(assignedAt, gracePeriodDays) <= now;
  }

  private toAssignmentData(
    doc: TrainingAssignmentDocument,
    gracePeriodDays: number,
    userFullName: string,
    now: Date = new Date(),
  ): TrainingAssignmentData {
    const isPending = doc.status === TrainingAssignmentStatus.PENDING;
    const dueDate = isPending ? this.computeDueDate(doc.assignedAt, gracePeriodDays) : null;
    return {
      id: doc._id.toString(),
      tenantId: doc.tenantId.toString(),
      userId: doc.userId,
      userFullName,
      documentId: doc.documentId,
      docNumber: doc.docNumber,
      documentTitle: doc.documentTitle,
      versionId: doc.versionId,
      versionLabel: doc.versionLabel,
      status: doc.status,
      assignedAt: doc.assignedAt.toISOString(),
      dueDate: dueDate ? dueDate.toISOString() : null,
      isOverdue: isPending && dueDate !== null && dueDate <= now,
      completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    };
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
