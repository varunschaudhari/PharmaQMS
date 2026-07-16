import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { TrainingAssessmentStatus } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleSchema } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../../platform/auth/schemas/user.schema';
import { esignConfig } from '../../../platform/esign/config/esign.config';
import { EsignService } from '../../../platform/esign/esign.service';
import { Signature, SignatureSchema } from '../../../platform/esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../../platform/esign/schemas/signing-token-usage.schema';
import { NOTIFICATION_JOBS } from '../../../platform/notifications/jobs/notification-jobs.interface';
import { NotificationsService } from '../../../platform/notifications/notifications.service';
import { Notification, NotificationDocument, NotificationSchema } from '../../../platform/notifications/schemas/notification.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import {
  DocumentTrainingTarget,
  DocumentTrainingTargetSchema,
} from '../schemas/document-training-target.schema';
import { TrainingAssessmentAttempt, TrainingAssessmentAttemptDocument, TrainingAssessmentAttemptSchema } from '../schemas/training-assessment-attempt.schema';
import { TrainingAssessment, TrainingAssessmentSchema } from '../schemas/training-assessment.schema';
import { TrainingAssignment, TrainingAssignmentDocument, TrainingAssignmentSchema } from '../schemas/training-assignment.schema';
import { TrainingAssessmentService } from '../training-assessment.service';
import { TrainingService } from '../training.service';

describe('TRN-6 TrainingAssessmentService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let trainingService: TrainingService;
  let assessmentService: TrainingAssessmentService;
  let assignmentModel: Model<TrainingAssignmentDocument>;
  let attemptModel: Model<TrainingAssessmentAttemptDocument>;
  let departmentModel: Model<DepartmentDocument>;
  let notificationModel: Model<NotificationDocument>;
  let tenantModel: Model<TenantDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [esignConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: TrainingAssignment.name, schema: TrainingAssignmentSchema },
          { name: DocumentTrainingTarget.name, schema: DocumentTrainingTargetSchema },
          { name: TrainingAssessment.name, schema: TrainingAssessmentSchema },
          { name: TrainingAssessmentAttempt.name, schema: TrainingAssessmentAttemptSchema },
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [
        TrainingService,
        TrainingAssessmentService,
        EsignService,
        AuditService,
        PdfRenderService,
        NotificationsService,
        { provide: NOTIFICATION_JOBS, useValue: { enqueueEmail: jest.fn() } },
      ],
    }).compile();

    trainingService = moduleRef.get(TrainingService);
    assessmentService = moduleRef.get(TrainingAssessmentService);
    assignmentModel = moduleRef.get(getModelToken(TrainingAssignment.name));
    attemptModel = moduleRef.get(getModelToken(TrainingAssessmentAttempt.name));
    departmentModel = moduleRef.get(getModelToken(Department.name));
    notificationModel = moduleRef.get(getModelToken(Notification.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    await assignmentModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const qa = { userId: id(), fullName: 'Quinn Qahead' };

  async function seedAssignment(tenantId: string, overrides: Partial<{ userId: string; departmentId: string }> = {}) {
    const userModel: Model<UserDocument> = moduleRef.get(getModelToken(User.name));
    let userId = overrides.userId;
    let departmentId = overrides.departmentId;
    if (!userId) {
      if (!departmentId) {
        const department = await departmentModel.create({ tenantId, name: 'Production', code: `PR${id().slice(-4)}` });
        departmentId = department._id.toString();
      }
      const passwordHash = await bcrypt.hash('x', 4);
      const trainee = await userModel.create({
        tenantId,
        email: `trainee.${id()}@example.com`,
        fullName: 'Olive Operator',
        passwordHash,
        roleId: new mongoose.Types.ObjectId(),
        departmentId,
        isActive: true,
      });
      userId = trainee._id.toString();
    }

    const assignment = await assignmentModel.create({
      tenantId,
      userId,
      documentId: 'doc-1',
      docNumber: 'SOP-QA-001',
      documentTitle: 'Cleaning of pH meters',
      versionId: 'ver-1',
      versionLabel: '1.0',
      status: 'pending',
      assignedAt: new Date(),
    });
    return { assignmentId: assignment._id.toString(), userId, departmentId };
  }

  const QUESTIONS = [
    { questionText: 'What is the required cleaning frequency?', options: ['Daily', 'Weekly', 'Monthly'], correctOptionIndex: 0 },
    { questionText: 'Who signs the cleaning log?', options: ['Operator', 'QA Head', 'Nobody'], correctOptionIndex: 0 },
  ];

  it('TRN-6: QA authors a Draft assessment, approves it, and editing it again resets it to Draft', async () => {
    const tenantId = id();
    const authored = await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, {
      docNumber: 'SOP-QA-001',
      versionLabel: '1.0',
      questions: QUESTIONS,
    });
    expect(authored.status).toBe(TrainingAssessmentStatus.DRAFT);

    const approved = await assessmentService.approveAssessment(tenantId, 'ver-1', qa);
    expect(approved.status).toBe(TrainingAssessmentStatus.APPROVED);
    expect(approved.approvedByUserId).toBe(qa.userId);

    const reEdited = await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, {
      docNumber: 'SOP-QA-001',
      versionLabel: '1.0',
      questions: QUESTIONS,
    });
    expect(reEdited.status).toBe(TrainingAssessmentStatus.DRAFT);
  });

  it('TRN-6: the trainee-facing view never carries the answer key', async () => {
    const tenantId = id();
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    await assessmentService.approveAssessment(tenantId, 'ver-1', qa);
    const { assignmentId, userId } = await seedAssignment(tenantId);

    const forTrainee = await assessmentService.getForTrainee(tenantId, assignmentId, userId);
    expect(forTrainee).not.toBeNull();
    expect(forTrainee!.questions).toHaveLength(2);
    for (const q of forTrainee!.questions) {
      expect(q).not.toHaveProperty('correctOptionIndex');
    }
  });

  it('TRN-6: scores an attempt, and a passing attempt unblocks TRN-2 completion', async () => {
    const tenantId = id();
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    await assessmentService.approveAssessment(tenantId, 'ver-1', qa);
    const { assignmentId, userId } = await seedAssignment(tenantId);

    const authoring = await assessmentService.getForAuthoring(tenantId, 'ver-1');
    const [q1, q2] = authoring!.questions;

    // Blocked before any passing attempt exists.
    await expect(
      trainingService.completeAssignment(tenantId, { userId, tenantId, fullName: 'Olive Operator' }, assignmentId),
    ).rejects.toThrow(/Complete and pass the assessment/);

    const result = await assessmentService.submitAttempt(tenantId, assignmentId, { userId, fullName: 'Olive Operator' }, {
      answers: [
        { questionId: q1.id, selectedOptionIndex: q1.correctOptionIndex },
        { questionId: q2.id, selectedOptionIndex: q2.correctOptionIndex },
      ],
    });
    expect(result.attempt.scorePercentage).toBe(100);
    expect(result.attempt.passed).toBe(true);
    expect(result.attempt.attemptNumber).toBe(1);

    const completed = await trainingService.completeAssignment(tenantId, { userId, tenantId, fullName: 'Olive Operator' }, assignmentId);
    expect(completed.status).toBe('completed');
  });

  it('TRN-6: a failing attempt notifies the trainee; reaching max attempts escalates to the department head', async () => {
    const tenantId = id();
    await tenantModel.create({ _id: tenantId, name: 'Acme Pharma', slug: `acme-${tenantId}`, settings: { trainingAssessmentMaxAttempts: 2 } });
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    await assessmentService.approveAssessment(tenantId, 'ver-1', qa);

    const department = await departmentModel.create({ tenantId, name: 'Production', code: 'PROD' });
    const headUserId = id();
    department.headUserId = headUserId;
    await department.save();
    const { assignmentId, userId } = await seedAssignment(tenantId, { departmentId: department._id.toString() });

    const authoring = await assessmentService.getForAuthoring(tenantId, 'ver-1');
    const [q1, q2] = authoring!.questions;
    const wrongAnswers = {
      answers: [
        { questionId: q1.id, selectedOptionIndex: (q1.correctOptionIndex + 1) % q1.options.length },
        { questionId: q2.id, selectedOptionIndex: (q2.correctOptionIndex + 1) % q2.options.length },
      ],
    };

    const first = await assessmentService.submitAttempt(tenantId, assignmentId, { userId, fullName: 'Olive Operator' }, wrongAnswers);
    expect(first.attempt.passed).toBe(false);
    expect(first.maxAttemptsReached).toBe(false);
    expect(first.attemptsRemaining).toBe(1);

    const traineeNotificationsAfterFirst = await notificationModel.find({ tenantId, userId });
    expect(traineeNotificationsAfterFirst.length).toBeGreaterThanOrEqual(1);
    const headNotificationsAfterFirst = await notificationModel.find({ tenantId, userId: headUserId });
    expect(headNotificationsAfterFirst).toHaveLength(0);

    const second = await assessmentService.submitAttempt(tenantId, assignmentId, { userId, fullName: 'Olive Operator' }, wrongAnswers);
    expect(second.attempt.passed).toBe(false);
    expect(second.maxAttemptsReached).toBe(true);
    expect(second.attemptsRemaining).toBe(0);

    const headNotificationsAfterSecond = await notificationModel.find({ tenantId, userId: headUserId });
    expect(headNotificationsAfterSecond).toHaveLength(1);

    // A 3rd attempt beyond the configured max is rejected outright.
    await expect(assessmentService.submitAttempt(tenantId, assignmentId, { userId, fullName: 'Olive Operator' }, wrongAnswers)).rejects.toThrow(AppException);
  });

  it('TRN-6: attempts are append-only — a direct update/delete attempt throws', async () => {
    const tenantId = id();
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    await assessmentService.approveAssessment(tenantId, 'ver-1', qa);
    const { assignmentId, userId } = await seedAssignment(tenantId);
    const authoring = await assessmentService.getForAuthoring(tenantId, 'ver-1');
    const [q1, q2] = authoring!.questions;

    const result = await assessmentService.submitAttempt(tenantId, assignmentId, { userId, fullName: 'Olive Operator' }, {
      answers: [
        { questionId: q1.id, selectedOptionIndex: q1.correctOptionIndex },
        { questionId: q2.id, selectedOptionIndex: q2.correctOptionIndex },
      ],
    });

    await expect(attemptModel.updateOne({ _id: result.attempt.id }, { $set: { scorePercentage: 0 } })).rejects.toThrow('append-only');
    await expect(attemptModel.deleteOne({ _id: result.attempt.id })).rejects.toThrow('append-only');
  });

  it('TRN-6 (a): a new Effective version carries forward the assessment as a fresh Draft, requiring re-approval', async () => {
    const tenantId = id();
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    await assessmentService.approveAssessment(tenantId, 'ver-1', qa);

    // Simulate DOC-9/TRN-3's event: a new version becomes Effective for the same document.
    await trainingService.upsertTrainingTarget({
      tenantId,
      documentId: 'doc-1',
      docNumber: 'SOP-QA-001',
      title: 'Cleaning of pH meters',
      effectiveVersionId: 'ver-1',
      effectiveVersionLabel: '1.0',
      distributionRoleIds: [],
      distributionDepartmentIds: [],
    });
    await trainingService.upsertTrainingTarget({
      tenantId,
      documentId: 'doc-1',
      docNumber: 'SOP-QA-001',
      title: 'Cleaning of pH meters',
      effectiveVersionId: 'ver-2',
      effectiveVersionLabel: '2.0',
      distributionRoleIds: [],
      distributionDepartmentIds: [],
    });

    const carriedForward = await assessmentService.getForAuthoring(tenantId, 'ver-2');
    expect(carriedForward).not.toBeNull();
    expect(carriedForward!.status).toBe(TrainingAssessmentStatus.DRAFT);
    expect(carriedForward!.questions).toHaveLength(2);
    expect(carriedForward!.createdByUserId).toBeNull();

    // Not yet usable by a trainee — the version has no Approved assessment yet.
    const hasApproved = await assessmentService.hasApprovedAssessment(tenantId, 'ver-2');
    expect(hasApproved).toBe(false);
  });

  it('Iron Rule 5: assessments and attempts are invisible across tenants', async () => {
    const tenantId = id();
    await assessmentService.upsertAssessment(tenantId, 'doc-1', 'ver-1', qa, { docNumber: 'SOP-QA-001', versionLabel: '1.0', questions: QUESTIONS });
    const otherTenant = id();
    const forAuthoring = await assessmentService.getForAuthoring(otherTenant, 'ver-1');
    expect(forAuthoring).toBeNull();
  });
});
