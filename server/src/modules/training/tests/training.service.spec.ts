import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { TrainingAssignmentStatus } from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { Role, RoleSchema } from '../../../platform/auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../../platform/auth/schemas/user.schema';
import { esignConfig } from '../../../platform/esign/config/esign.config';
import { EsignService } from '../../../platform/esign/esign.service';
import { Signature, SignatureSchema } from '../../../platform/esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../../platform/esign/schemas/signing-token-usage.schema';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { NOTIFICATION_JOBS } from '../../../platform/notifications/jobs/notification-jobs.interface';
import { NotificationsService } from '../../../platform/notifications/notifications.service';
import { Notification, NotificationSchema } from '../../../platform/notifications/schemas/notification.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import {
  DocumentTrainingTarget,
  DocumentTrainingTargetDocument,
  DocumentTrainingTargetSchema,
} from '../schemas/document-training-target.schema';
import { TrainingAssessmentAttempt, TrainingAssessmentAttemptSchema } from '../schemas/training-assessment-attempt.schema';
import { TrainingAssessment, TrainingAssessmentSchema } from '../schemas/training-assessment.schema';
import { TrainingAssignment, TrainingAssignmentDocument, TrainingAssignmentSchema } from '../schemas/training-assignment.schema';
import { TrainingAssessmentService } from '../training-assessment.service';
import { TrainingService } from '../training.service';

describe('TRN-1 TRN-2 TRN-3 TRN-5 TrainingService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let trainingService: TrainingService;
  let assignmentModel: Model<TrainingAssignmentDocument>;
  let targetModel: Model<DocumentTrainingTargetDocument>;
  let userModel: Model<UserDocument>;
  let departmentModel: Model<DepartmentDocument>;
  let tenantModel: Model<TenantDocument>;
  let auditEventModel: Model<AuditEventDocument>;
  let esignService: EsignService;

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
    assignmentModel = moduleRef.get(getModelToken(TrainingAssignment.name));
    targetModel = moduleRef.get(getModelToken(DocumentTrainingTarget.name));
    userModel = moduleRef.get(getModelToken(User.name));
    departmentModel = moduleRef.get(getModelToken(Department.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
    esignService = moduleRef.get(EsignService);
    await assignmentModel.init();
    await targetModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  async function seedUser(tenantId: string, roleId: string, departmentId: string | null, fullName = 'Employee'): Promise<UserDocument> {
    const passwordHash = await bcrypt.hash('Correct1!', 10);
    return userModel.create({
      tenantId,
      email: `${fullName.toLowerCase().replace(/\s+/g, '.')}.${id()}@example.com`,
      fullName,
      passwordHash,
      roleId,
      departmentId,
    });
  }

  function trainingTargetEvent(
    tenantId: string,
    documentId: string,
    overrides: Partial<{
      docNumber: string;
      title: string;
      effectiveVersionId: string | null;
      effectiveVersionLabel: string | null;
      distributionRoleIds: string[];
      distributionDepartmentIds: string[];
    }> = {},
  ) {
    return {
      tenantId,
      documentId,
      docNumber: overrides.docNumber ?? 'SOP-QA-001',
      title: overrides.title ?? 'Cleaning of pH meters',
      effectiveVersionId: overrides.effectiveVersionId !== undefined ? overrides.effectiveVersionId : id(),
      effectiveVersionLabel: overrides.effectiveVersionLabel !== undefined ? overrides.effectiveVersionLabel : '1.0',
      distributionRoleIds: overrides.distributionRoleIds ?? [],
      distributionDepartmentIds: overrides.distributionDepartmentIds ?? [],
    };
  }

  it('TRN-1: a distribution-list edit with an Effective version auto-generates pending assignments for every mapped user (role + department)', async () => {
    const tenantId = id();
    const roleId = id();
    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    const roleUser = await seedUser(tenantId, roleId, null, 'Role Match');
    const deptUser = await seedUser(tenantId, id(), department._id.toString(), 'Dept Match');
    const unrelatedUser = await seedUser(tenantId, id(), null, 'Unrelated');
    const documentId = id();

    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, {
        distributionRoleIds: [roleId],
        distributionDepartmentIds: [department._id.toString()],
      }),
    );

    const roleUserAssignments = await trainingService.listForUser(tenantId, roleUser._id.toString());
    const deptUserAssignments = await trainingService.listForUser(tenantId, deptUser._id.toString());
    const unrelatedAssignments = await trainingService.listForUser(tenantId, unrelatedUser._id.toString());

    expect(roleUserAssignments).toHaveLength(1);
    expect(roleUserAssignments[0].status).toBe(TrainingAssignmentStatus.PENDING);
    expect(roleUserAssignments[0].docNumber).toBe('SOP-QA-001');
    expect(deptUserAssignments).toHaveLength(1);
    expect(unrelatedAssignments).toHaveLength(0);

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'TrainingAssignment' });
    expect(auditEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('TRN-1: "adding a user to a role" (syncAssignmentsForUser) auto-generates their pending items for already-configured documents', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );

    const newUser = await seedUser(tenantId, roleId, null, 'New Hire');
    // Nothing yet — the target was configured before this user existed.
    expect(await trainingService.listForUser(tenantId, newUser._id.toString())).toHaveLength(0);

    await trainingService.syncAssignmentsForUser({ tenantId, userId: newUser._id.toString(), roleId, departmentId: null });

    const assignments = await trainingService.listForUser(tenantId, newUser._id.toString());
    expect(assignments).toHaveLength(1);
    expect(assignments[0].status).toBe(TrainingAssignmentStatus.PENDING);
  });

  it('TRN-2: completing an assignment e-signs "Trained — read and understood" and marks it completed', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantId, roleId, null);
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );
    const [assignment] = await trainingService.listForUser(tenantId, user._id.toString());

    const completed = await trainingService.completeAssignment(
      tenantId,
      { userId: user._id.toString(), tenantId, fullName: user.fullName },
      assignment.id,
    );

    expect(completed.status).toBe(TrainingAssignmentStatus.COMPLETED);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.dueDate).toBeNull();

    const signatures = await esignService.findForEntity(tenantId, 'TrainingAssignment', assignment.id);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].meaning).toBe('trained_read_and_understood');
  });

  it('TRN-2: a user cannot complete someone else\'s training assignment', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const owner = await seedUser(tenantId, roleId, null, 'Owner');
    const outsider = await seedUser(tenantId, roleId, null, 'Outsider');
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );
    const [assignment] = await trainingService.listForUser(tenantId, owner._id.toString());

    await expect(
      trainingService.completeAssignment(
        tenantId,
        { userId: outsider._id.toString(), tenantId, fullName: outsider.fullName },
        assignment.id,
      ),
    ).rejects.toThrow(AppException);
  });

  it('TRN-2: an already-completed assignment cannot be completed again', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantId, roleId, null);
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );
    const [assignment] = await trainingService.listForUser(tenantId, user._id.toString());
    const signer = { userId: user._id.toString(), tenantId, fullName: user.fullName };
    await trainingService.completeAssignment(tenantId, signer, assignment.id);

    await expect(trainingService.completeAssignment(tenantId, signer, assignment.id)).rejects.toThrow(
      /already been completed/,
    );
  });

  it('TRN-3: a new Effective version retargets an OPEN pending assignment in place — no duplicate row', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantId, roleId, null);
    const v1Id = id();
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId], effectiveVersionId: v1Id, effectiveVersionLabel: '1.0' }),
    );

    const v2Id = id();
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId], effectiveVersionId: v2Id, effectiveVersionLabel: '2.0' }),
    );

    const assignments = await trainingService.listForUser(tenantId, user._id.toString());
    expect(assignments).toHaveLength(1); // retargeted, not duplicated
    expect(assignments[0].versionLabel).toBe('2.0');
    expect(assignments[0].status).toBe(TrainingAssignmentStatus.PENDING);
  });

  it('TRN-3: "status flips to training due" — a user already COMPLETED on the old version gets a fresh PENDING row for the new version', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantId, roleId, null);
    const v1Id = id();
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId], effectiveVersionId: v1Id, effectiveVersionLabel: '1.0' }),
    );
    const [v1Assignment] = await trainingService.listForUser(tenantId, user._id.toString());
    await trainingService.completeAssignment(tenantId, { userId: user._id.toString(), tenantId, fullName: user.fullName }, v1Assignment.id);

    const v2Id = id();
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId], effectiveVersionId: v2Id, effectiveVersionLabel: '2.0' }),
    );

    const assignments = await trainingService.listForUser(tenantId, user._id.toString());
    expect(assignments).toHaveLength(2);
    const v1Row = assignments.find((a) => a.versionLabel === '1.0')!;
    const v2Row = assignments.find((a) => a.versionLabel === '2.0')!;
    expect(v1Row.status).toBe(TrainingAssignmentStatus.COMPLETED); // untouched history
    expect(v2Row.status).toBe(TrainingAssignmentStatus.PENDING); // training due again
  });

  it('TRN-5: listOverdue only returns PENDING assignments past the tenant grace period', async () => {
    const tenantObjectId = new mongoose.Types.ObjectId();
    const tenantId = tenantObjectId.toString();
    await tenantModel.create({
      _id: tenantObjectId,
      name: 'Grace Co',
      slug: `grace-${id()}`,
      settings: { trainingGracePeriodDays: 3 },
    });
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantId, roleId, null, 'Grace Employee');
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );
    const [assignment] = await trainingService.listForUser(tenantId, user._id.toString());
    // Force assignedAt into the past so it is overdue against the 3-day grace period.
    await assignmentModel.updateOne({ _id: assignment.id }, { $set: { assignedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) } });

    const overdue = await trainingService.listOverdue(tenantId);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].isOverdue).toBe(true);
    expect(overdue[0].userFullName).toBe('Grace Employee');
  });

  it('TRN-5: an assignment still within the grace period is not overdue', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    await seedUser(tenantId, roleId, null);
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );

    expect(await trainingService.listOverdue(tenantId)).toHaveLength(0);
  });

  it('TRN-1: getMatrix reports assigned/completed/overdue counts per document', async () => {
    const tenantId = id();
    const roleId = id();
    const documentId = id();
    const user1 = await seedUser(tenantId, roleId, null, 'Matrix One');
    const user2 = await seedUser(tenantId, roleId, null, 'Matrix Two');
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantId, documentId, { distributionRoleIds: [roleId] }),
    );
    const [a1] = await trainingService.listForUser(tenantId, user1._id.toString());
    await trainingService.completeAssignment(tenantId, { userId: user1._id.toString(), tenantId, fullName: user1.fullName }, a1.id);
    void user2;

    const matrix = await trainingService.getMatrix(tenantId);
    const entry = matrix.find((m) => m.documentId === documentId)!;
    expect(entry.totalAssigned).toBe(2);
    expect(entry.totalCompleted).toBe(1);
    expect(entry.hasEffectiveVersion).toBe(true);
  });

  it('Iron Rule 5: assignments and targets are invisible across tenants', async () => {
    const tenantA = id();
    const tenantB = id();
    const roleId = id();
    const documentId = id();
    const user = await seedUser(tenantA, roleId, null);
    await trainingService.upsertTrainingTarget(
      trainingTargetEvent(tenantA, documentId, { distributionRoleIds: [roleId] }),
    );

    expect(await trainingService.listForUser(tenantA, user._id.toString())).toHaveLength(1);
    await expect(trainingService.listForUser(tenantB, user._id.toString())).rejects.toThrow('Employee not found.');
    expect(await trainingService.getMatrix(tenantB)).toHaveLength(0);
  });
});
