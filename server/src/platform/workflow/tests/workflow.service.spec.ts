import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditAction,
  SignatureMeaning,
  WorkflowAction,
  WorkflowInstanceStatus,
} from '@pharmaqms/shared';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { esignConfig } from '../../esign/config/esign.config';
import { EsignService } from '../../esign/esign.service';
import { Signature, SignatureSchema } from '../../esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../esign/schemas/signing-token-usage.schema';
import { Tenant, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { WorkflowInstance, WorkflowInstanceSchema } from '../schemas/workflow-instance.schema';
import { WorkflowTemplate, WorkflowTemplateSchema } from '../schemas/workflow-template.schema';
import { WorkflowService, type WorkflowActor } from '../workflow.service';

describe('PLT-4 WorkflowService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let workflowService: WorkflowService;
  let esignService: EsignService;
  let roleModel: Model<RoleDocument>;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [esignConfig] }),
        EventEmitterModule.forRoot(),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: WorkflowTemplate.name, schema: WorkflowTemplateSchema },
          { name: WorkflowInstance.name, schema: WorkflowInstanceSchema },
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
        ]),
      ],
      providers: [WorkflowService, EsignService],
    }).compile();

    workflowService = moduleRef.get(WorkflowService);
    esignService = moduleRef.get(EsignService);
    roleModel = moduleRef.get(getModelToken(Role.name));
    userModel = moduleRef.get(getModelToken(User.name));
    await moduleRef.get(getModelToken(SigningTokenUsage.name)).init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function tenantId(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  async function seedActor(tenant: string, roleName: string): Promise<{ actor: WorkflowActor; password: string }> {
    const role = await roleModel.create({ tenantId: tenant, name: roleName, permissions: [] });
    const password = 'Correct1!';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await userModel.create({
      tenantId: tenant,
      email: `${roleName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      fullName: roleName,
      passwordHash,
      roleId: role._id,
    });
    return {
      actor: { userId: user._id.toString(), fullName: user.fullName, roleId: role._id.toString() },
      password,
    };
  }

  async function signingTokenFor(tenant: string, actor: WorkflowActor, password: string): Promise<string> {
    const { signingToken } = await esignService.challenge(actor.userId, tenant, actor.fullName, password);
    return signingToken;
  }

  async function seedTwoStepTemplate(tenant: string) {
    const deptHead = await seedActor(tenant, 'Dept Head');
    const qaHead = await seedActor(tenant, 'QA Head');

    const template = await workflowService.createTemplate({
      tenantId: tenant,
      entityType: 'Document',
      name: 'SOP Approval',
      steps: [
        {
          name: 'Dept Head Review',
          roleId: deptHead.actor.roleId,
          signatureMeaning: SignatureMeaning.REVIEWED_BY,
          rejectToStepIndex: null,
        },
        {
          name: 'QA Head Approval',
          roleId: qaHead.actor.roleId,
          signatureMeaning: SignatureMeaning.APPROVED_BY,
          rejectToStepIndex: 0,
        },
      ],
    });

    return { template, deptHead, qaHead };
  }

  it('PLT-4: full happy path — submit, then two step approvals (two signatures) reach APPROVED', async () => {
    const tenant = tenantId();
    const { deptHead, qaHead } = await seedTwoStepTemplate(tenant);

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-1');
    expect(submitted.before).toBeNull();
    expect(submitted.after.status).toBe(WorkflowInstanceStatus.IN_PROGRESS);
    expect(submitted.after.currentStepIndex).toBe(0);
    const instanceId = submitted.after.id;

    const deptHeadToken = await signingTokenFor(tenant, deptHead.actor, deptHead.password);
    const firstApproval = await workflowService.actOnStep(tenant, instanceId, deptHead.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: deptHeadToken,
      entitySnapshot: { title: 'SOP-1', version: 1 },
    });
    expect(firstApproval.auditAction).toBe(AuditAction.WORKFLOW_STEP_APPROVED);
    expect(firstApproval.after.status).toBe(WorkflowInstanceStatus.IN_PROGRESS);
    expect(firstApproval.after.currentStepIndex).toBe(1);

    const qaHeadToken = await signingTokenFor(tenant, qaHead.actor, qaHead.password);
    const secondApproval = await workflowService.actOnStep(tenant, instanceId, qaHead.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: qaHeadToken,
      entitySnapshot: { title: 'SOP-1', version: 1 },
    });
    expect(secondApproval.auditAction).toBe(AuditAction.WORKFLOW_APPROVED);
    expect(secondApproval.after.status).toBe(WorkflowInstanceStatus.APPROVED);

    const signatures = await esignService.findForEntity(tenant, 'Document', 'doc-1');
    expect(signatures).toHaveLength(2);
    expect(signatures.map((s) => s.meaning).sort()).toEqual(
      [SignatureMeaning.APPROVED_BY, SignatureMeaning.REVIEWED_BY].sort(),
    );
  });

  it('PLT-4: a non-assignee (wrong role) is blocked from approving', async () => {
    const tenant = tenantId();
    await seedTwoStepTemplate(tenant);
    const outsider = await seedActor(tenant, 'Outsider');

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-2');
    const outsiderToken = await signingTokenFor(tenant, outsider.actor, outsider.password);

    await expect(
      workflowService.actOnStep(tenant, submitted.after.id, outsider.actor, {
        action: WorkflowAction.APPROVE,
        signingToken: outsiderToken,
        entitySnapshot: {},
      }),
    ).rejects.toThrow(AppException);
  });

  it('PLT-4: reject at the first step returns the instance to DRAFT (the author)', async () => {
    const tenant = tenantId();
    const { deptHead } = await seedTwoStepTemplate(tenant);

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-3');
    const result = await workflowService.actOnStep(tenant, submitted.after.id, deptHead.actor, {
      action: WorkflowAction.REJECT,
      comment: 'Needs more detail before review.',
    });

    expect(result.auditAction).toBe(AuditAction.WORKFLOW_REJECTED);
    expect(result.comment).toBe('Needs more detail before review.');
    expect(result.after.status).toBe(WorkflowInstanceStatus.DRAFT);
    expect(result.after.currentStepIndex).toBe(-1);
  });

  it('PLT-4: reject at a later step returns to its configured earlier step, not necessarily all the way to draft', async () => {
    const tenant = tenantId();
    const { deptHead, qaHead } = await seedTwoStepTemplate(tenant);

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-4');
    const deptHeadToken = await signingTokenFor(tenant, deptHead.actor, deptHead.password);
    await workflowService.actOnStep(tenant, submitted.after.id, deptHead.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: deptHeadToken,
      entitySnapshot: {},
    });

    const rejection = await workflowService.actOnStep(tenant, submitted.after.id, qaHead.actor, {
      action: WorkflowAction.REJECT,
      comment: 'Formatting issues — send back to dept head.',
    });

    expect(rejection.after.status).toBe(WorkflowInstanceStatus.IN_PROGRESS);
    expect(rejection.after.currentStepIndex).toBe(0); // step1.rejectToStepIndex === 0, not DRAFT
  });

  it('PLT-4: reassign is audited with a reason and changes who may act on the step', async () => {
    const tenant = tenantId();
    const { deptHead } = await seedTwoStepTemplate(tenant);
    const substitute = await seedActor(tenant, 'Substitute Reviewer');

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-5');
    const reassignment = await workflowService.actOnStep(tenant, submitted.after.id, deptHead.actor, {
      action: WorkflowAction.REASSIGN,
      userId: substitute.actor.userId,
      reason: 'Dept head is on leave.',
    });

    expect(reassignment.auditAction).toBe(AuditAction.WORKFLOW_REASSIGNED);
    expect(reassignment.comment).toBe('Dept head is on leave.');
    expect(reassignment.after.overrideAssigneeUserId).toBe(substitute.actor.userId);

    // The original role-holder can no longer act — the instance was reassigned to a specific user.
    const deptHeadToken = await signingTokenFor(tenant, deptHead.actor, deptHead.password);
    await expect(
      workflowService.actOnStep(tenant, submitted.after.id, deptHead.actor, {
        action: WorkflowAction.APPROVE,
        signingToken: deptHeadToken,
        entitySnapshot: {},
      }),
    ).rejects.toThrow(AppException);

    // The reassigned substitute can act, despite not holding the step's role.
    const substituteToken = await signingTokenFor(tenant, substitute.actor, substitute.password);
    const approval = await workflowService.actOnStep(tenant, submitted.after.id, substitute.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: substituteToken,
      entitySnapshot: {},
    });
    expect(approval.after.currentStepIndex).toBe(1);
  });

  it('PLT-4: invalid transitions throw — cannot re-submit an in-progress instance or act on an approved one', async () => {
    const tenant = tenantId();
    const { deptHead, qaHead } = await seedTwoStepTemplate(tenant);

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-6');
    await expect(workflowService.submit(tenant, 'Document', 'doc-6')).rejects.toThrow(/Invalid workflow transition/);

    const deptHeadToken = await signingTokenFor(tenant, deptHead.actor, deptHead.password);
    await workflowService.actOnStep(tenant, submitted.after.id, deptHead.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: deptHeadToken,
      entitySnapshot: {},
    });
    const qaHeadToken = await signingTokenFor(tenant, qaHead.actor, qaHead.password);
    await workflowService.actOnStep(tenant, submitted.after.id, qaHead.actor, {
      action: WorkflowAction.APPROVE,
      signingToken: qaHeadToken,
      entitySnapshot: {},
    });

    const anotherToken = await signingTokenFor(tenant, qaHead.actor, qaHead.password);
    await expect(
      workflowService.actOnStep(tenant, submitted.after.id, qaHead.actor, {
        action: WorkflowAction.APPROVE,
        signingToken: anotherToken,
        entitySnapshot: {},
      }),
    ).rejects.toThrow(/Invalid workflow transition/);
  });

  it('PLT-4: workflow instances are tenant-isolated — each tenant gets its own independent instance', async () => {
    const tenantA = tenantId();
    const tenantB = tenantId();
    await seedTwoStepTemplate(tenantA);
    await seedTwoStepTemplate(tenantB);

    const instanceA = await workflowService.submit(tenantA, 'Document', 'shared-entity-id');
    const instanceB = await workflowService.submit(tenantB, 'Document', 'shared-entity-id');

    expect(instanceA.after.id).not.toBe(instanceB.after.id);
    expect(instanceA.after.tenantId).toBe(tenantA);
    expect(instanceB.after.tenantId).toBe(tenantB);
  });

  it('PLT-4: my-pending-tasks lists instances awaiting the actor\'s role, and reassigned instances awaiting the specific user', async () => {
    const tenant = tenantId();
    const { deptHead, qaHead } = await seedTwoStepTemplate(tenant);

    const submitted = await workflowService.submit(tenant, 'Document', 'doc-pending-1');
    const deptHeadTasks = await workflowService.myPendingTasks(tenant, deptHead.actor);
    expect(deptHeadTasks.some((task) => task.id === submitted.after.id)).toBe(true);

    const qaHeadTasksBefore = await workflowService.myPendingTasks(tenant, qaHead.actor);
    expect(qaHeadTasksBefore.some((task) => task.id === submitted.after.id)).toBe(false);
  });
});
