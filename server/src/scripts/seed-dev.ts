// Dev-only database bootstrap — makes a fresh local database browsable (SPEC.md §8 requires the
// Phase 0 demo to pass in the browser, and a fresh database has no tenant or user to log in with).
// Not a regulated feature: it runs out-of-band exactly like the documented direct-DB platform-admin
// bootstrap (see test-record.e2e-spec.ts), so these creates carry no audit events. Everything that
// CAN go through a real PLT-8/PLT-5/PLT-4 service does, so seeded data matches production shapes.
//
// Usage: `npm run seed` (repo root) or `npm run seed -w server`. Requires Mongo (+ Redis) from
// `docker compose up -d`. Idempotent per item: existing roles/users/departments/schemes/templates
// are reused (roles are realigned to the permission sets below), missing ones are created.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import {
  DocumentType,
  MaterialLotStatus,
  PermissionAction,
  PermissionModule,
  RoomClassification,
  RoomCleaningFrequency,
  SignatureMeaning,
  WorkflowAction,
  type CreateCalibrationScheduleRequest,
  type CreateEquipmentRequest,
  type CreateMaterialLotRequest,
  type CreateRoomRequest,
  type PermissionKey,
  type UpsertRoomCleaningScheduleRequest,
} from '@pharmaqms/shared';
import { Model, Types } from 'mongoose';
import type { SigningContext } from '../common/decorators/current-signing-context.decorator';
import { AppModule } from '../app.module';
import { TEST_RECORD_ENTITY_TYPE, TEST_RECORD_NUMBERING_TYPE } from '../demo/test-record/test-record.service';
import { DOCUMENT_VERSION_ENTITY_TYPE } from '../modules/documents/document-entity-types';
import { DocumentEntity, DocumentEntityDocument } from '../modules/documents/schemas/document.schema';
import { DocumentsService, type DocumentActor, type UploadedDocumentFile } from '../modules/documents/documents.service';
import { CalibrationService, type CalibrationActor } from '../modules/equipment/calibration.service';
import { EQUIPMENT_NUMBERING_TYPE } from '../modules/equipment/equipment-entity-types';
import { Equipment, EquipmentDocument } from '../modules/equipment/schemas/equipment.schema';
import { EquipmentService } from '../modules/equipment/equipment.service';
import { MATERIAL_LOT_NUMBERING_TYPE } from '../modules/materials/material-lot-entity-types';
import { MaterialLot, MaterialLotDocument } from '../modules/materials/schemas/material-lot.schema';
import { MaterialLotService } from '../modules/materials/material-lot.service';
import { ROOM_NUMBERING_TYPE } from '../modules/rooms/room-entity-types';
import { Room, RoomDocument } from '../modules/rooms/schemas/room.schema';
import { RoomCleaningService, type RoomCleaningActor } from '../modules/rooms/room-cleaning.service';
import { RoomService } from '../modules/rooms/room.service';
import { Role, RoleDocument } from '../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../platform/auth/schemas/user.schema';
import { EsignService } from '../platform/esign/esign.service';
import { NumberingService } from '../platform/numbering/numbering.service';
import { NumberingScheme, NumberingSchemeDocument } from '../platform/numbering/schemas/numbering-scheme.schema';
import { DepartmentService } from '../platform/tenant/department.service';
import { Tenant, TenantDocument } from '../platform/tenant/schemas/tenant.schema';
import { TenantService } from '../platform/tenant/tenant.service';
import { UserAdminService } from '../platform/tenant/user-admin.service';
import { WorkflowService, type WorkflowActor } from '../platform/workflow/workflow.service';

// Must match VITE_DEFAULT_TENANT_ID in client/.env — the client pins its login tenant at build
// time until slug-based tenant resolution lands (see client auth-context.tsx), so seeding this
// exact id makes the client work with zero configuration.
const DEMO_TENANT_ID = '000000000000000000000001';
const DEMO_PASSWORD = 'Demo123!';

const { VIEW, CREATE, EDIT, REVIEW, APPROVE, ADMIN } = PermissionAction;
const { DOCUMENTS, TRAINING, EQUIPMENT, ROOMS, MATERIALS, ADMIN: ADMIN_MODULE } = PermissionModule;

function perms(module: PermissionModule, actions: PermissionAction[]): PermissionKey[] {
  return actions.map((action): PermissionKey => `${module}:${action}`);
}

const EVERY_ACTION = [VIEW, CREATE, EDIT, REVIEW, APPROVE, ADMIN];

const ROLE_DEFINITIONS: Array<{ name: string; permissions: PermissionKey[] }> = [
  {
    name: 'Tenant Admin',
    permissions: [
      ...perms(DOCUMENTS, EVERY_ACTION),
      ...perms(TRAINING, EVERY_ACTION),
      ...perms(EQUIPMENT, EVERY_ACTION),
      ...perms(ROOMS, EVERY_ACTION),
      ...perms(MATERIALS, EVERY_ACTION),
      ...perms(ADMIN_MODULE, EVERY_ACTION),
    ],
  },
  {
    name: 'QA Head',
    permissions: [
      ...perms(DOCUMENTS, EVERY_ACTION),
      ...perms(TRAINING, EVERY_ACTION),
      ...perms(EQUIPMENT, EVERY_ACTION),
      ...perms(ROOMS, EVERY_ACTION),
      ...perms(MATERIALS, EVERY_ACTION),
      ...perms(ADMIN_MODULE, [VIEW]),
    ],
  },
  {
    name: 'Dept Head',
    permissions: [
      ...perms(DOCUMENTS, [VIEW, REVIEW]),
      ...perms(TRAINING, [VIEW]),
      ...perms(EQUIPMENT, [VIEW, CREATE, EDIT]),
      ...perms(ROOMS, [VIEW, CREATE, EDIT]),
      ...perms(MATERIALS, [VIEW, CREATE]),
    ],
  },
  {
    name: 'QA Executive',
    permissions: [
      ...perms(DOCUMENTS, [VIEW, CREATE, EDIT]),
      ...perms(TRAINING, [VIEW, CREATE, EDIT]),
      ...perms(EQUIPMENT, [VIEW, CREATE, EDIT]),
      ...perms(ROOMS, [VIEW, CREATE, EDIT]),
      // QRX-2: status-change ("QA Disposition") is QA-only — QA Executive gets APPROVE alongside
      // view/create, unlike Dept Head above.
      ...perms(MATERIALS, [VIEW, CREATE, APPROVE]),
    ],
  },
  {
    // EQP-6 logbook, QRX-1 cleaning log, and TRN-2 read-and-understood endpoints require
    // authentication only, so the shop-floor role stays view-only on the permission matrix.
    name: 'Operator',
    permissions: [...perms(DOCUMENTS, [VIEW]), ...perms(TRAINING, [VIEW]), ...perms(EQUIPMENT, [VIEW]), ...perms(ROOMS, [VIEW]), ...perms(MATERIALS, [VIEW])],
  },
  {
    // EQP-7: closing a maintenance task requires equipment:edit.
    name: 'Maintenance Engineer',
    permissions: perms(EQUIPMENT, [VIEW, EDIT]),
  },
];

const DEPARTMENTS = [
  { name: 'Quality Assurance', code: 'QA' },
  { name: 'Quality Control', code: 'QC' },
  { name: 'Production', code: 'PROD' },
  { name: 'Engineering', code: 'ENG' },
];

// entityType for document numbering is DocumentType uppercased (see DocumentsService.create).
const NUMBERING_SCHEMES = [
  { entityType: 'SOP', prefix: 'SOP', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false },
  { entityType: 'SPECIFICATION', prefix: 'SPC', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false },
  { entityType: 'PROTOCOL', prefix: 'PRT', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false },
  { entityType: 'FORMAT', prefix: 'FMT', useDepartmentToken: true, paddingWidth: 3, yearlyReset: false },
  { entityType: 'POLICY', prefix: 'POL', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false },
  { entityType: EQUIPMENT_NUMBERING_TYPE, prefix: 'EQP', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false },
  { entityType: ROOM_NUMBERING_TYPE, prefix: 'ROOM', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false },
  { entityType: MATERIAL_LOT_NUMBERING_TYPE, prefix: 'LOT', useDepartmentToken: false, paddingWidth: 3, yearlyReset: false },
  { entityType: TEST_RECORD_NUMBERING_TYPE, prefix: 'TR', useDepartmentToken: false, paddingWidth: 4, yearlyReset: false },
];

const USERS: Array<{ email: string; fullName: string; role: string; department: string | null }> = [
  { email: 'admin@demo.local', fullName: 'Demo Admin', role: 'Tenant Admin', department: null },
  { email: 'qa.head@demo.local', fullName: 'Qamar Hashmi', role: 'QA Head', department: 'QA' },
  { email: 'qa.exec@demo.local', fullName: 'Esha Qureshi', role: 'QA Executive', department: 'QA' },
  { email: 'prod.head@demo.local', fullName: 'Prakash Hegde', role: 'Dept Head', department: 'PROD' },
  // A second Dept Head holder (in QC rather than PROD) — "Dept Head" is one role shared across
  // departments in this permission model (not a per-department role), so both users see the same
  // pending-review queue. Added so the approval-flow demo has more than one reviewer to log in as.
  { email: 'qc.head@demo.local', fullName: 'Chetan Kulkarni', role: 'Dept Head', department: 'QC' },
  { email: 'operator@demo.local', fullName: 'Omkar Patil', role: 'Operator', department: 'PROD' },
  { email: 'maintenance@demo.local', fullName: 'Manoj Iyer', role: 'Maintenance Engineer', department: 'ENG' },
];

interface DemoActor {
  userId: string;
  fullName: string;
  roleId: string;
}

function printCredentials(): void {
  console.log('');
  console.log('Demo tenant: Demo Pharma');
  console.log(`  tenantId:  ${DEMO_TENANT_ID}  (already set as VITE_DEFAULT_TENANT_ID in client/.env)`);
  console.log(`  password:  ${DEMO_PASSWORD}  (same for every user; also the e-signature credential)`);
  console.log('');
  for (const user of USERS) {
    const dept = user.department ? ` · ${user.department}` : '';
    console.log(`  ${user.email.padEnd(26)} ${user.role}${dept}`);
  }
  console.log('');
  console.log('  admin@demo.local is also a platform admin (tenant provisioning UI).');
  console.log('  Client: http://localhost:5173 · API: http://localhost:4000/api/v1');
}

function samePermissions(a: PermissionKey[], b: PermissionKey[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev is a development bootstrap and must never run in production.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tenantModel = app.get<Model<TenantDocument>>(getModelToken(Tenant.name));
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const schemeModel = app.get<Model<NumberingSchemeDocument>>(getModelToken(NumberingScheme.name));
    const documentModel = app.get<Model<DocumentEntityDocument>>(getModelToken(DocumentEntity.name));
    const equipmentModel = app.get<Model<EquipmentDocument>>(getModelToken(Equipment.name));
    const roomModel = app.get<Model<RoomDocument>>(getModelToken(Room.name));
    const lotModel = app.get<Model<MaterialLotDocument>>(getModelToken(MaterialLot.name));
    const tenantService = app.get(TenantService);
    const departmentService = app.get(DepartmentService);
    const userAdminService = app.get(UserAdminService);
    const numberingService = app.get(NumberingService);
    const workflowService = app.get(WorkflowService);
    const esignService = app.get(EsignService);
    const documentsService = app.get(DocumentsService);
    const equipmentService = app.get(EquipmentService);
    const calibrationService = app.get(CalibrationService);
    const roomService = app.get(RoomService);
    const roomCleaningService = app.get(RoomCleaningService);
    const materialLotService = app.get(MaterialLotService);

    // TenantService.provisionTenant() cannot take a caller-chosen _id, and the client needs this
    // exact id (see DEMO_TENANT_ID above) — so the tenant document is created directly and the
    // admin role/user that provisionTenant would create come from the same role/user paths below.
    const existingTenant = await tenantModel.findById(DEMO_TENANT_ID);
    if (existingTenant) {
      console.log(`✓ tenant ${existingTenant.name} (already present)`);
    } else {
      await tenantModel.create({
        _id: new Types.ObjectId(DEMO_TENANT_ID),
        name: 'Demo Pharma',
        slug: 'demo-pharma',
        settings: {},
      });
      console.log('✓ tenant Demo Pharma');
    }

    // Roles have no HTTP surface yet (flagged since PLT-4) — direct model access, like the e2e
    // suites. Existing roles are realigned to the permission sets above so stale dev data
    // (e.g. a hand-made role missing most permissions) doesn't break seeded flows.
    const rolesByName = new Map<string, RoleDocument>();
    let rolesCreated = 0;
    let rolesRealigned = 0;
    for (const definition of ROLE_DEFINITIONS) {
      let role = await roleModel.findOne({ tenantId: DEMO_TENANT_ID, name: definition.name });
      if (!role) {
        role = await roleModel.create({
          tenantId: DEMO_TENANT_ID,
          name: definition.name,
          permissions: definition.permissions,
        });
        rolesCreated += 1;
      } else if (!samePermissions(role.permissions, definition.permissions)) {
        role.permissions = definition.permissions;
        await role.save();
        rolesRealigned += 1;
      }
      rolesByName.set(definition.name, role);
    }
    console.log(`✓ roles: ${rolesCreated} created, ${rolesRealigned} realigned, ${ROLE_DEFINITIONS.length} total`);

    const existingDepartments = await departmentService.list(DEMO_TENANT_ID);
    const departmentsByCode = new Map<string, string>(existingDepartments.map((d) => [d.code, d.id]));
    let departmentsCreated = 0;
    for (const department of DEPARTMENTS) {
      if (departmentsByCode.has(department.code)) continue;
      const created = await departmentService.create({ tenantId: DEMO_TENANT_ID, ...department });
      departmentsByCode.set(department.code, created.id);
      departmentsCreated += 1;
    }
    console.log(`✓ departments: ${departmentsCreated} created`);

    const usersByEmail = new Map<string, string>();
    // Reused below for sample business data — {userId, fullName, roleId} is exactly what
    // DocumentActor/WorkflowActor/CalibrationActor/etc. need, so one map covers every seed call.
    const demoActors = new Map<string, DemoActor>();
    let usersCreated = 0;
    for (const user of USERS) {
      const role = rolesByName.get(user.role);
      if (!role) throw new Error(`Unknown role "${user.role}"`);
      const roleId = role._id.toString();
      const existing = await userModel.findOne({ tenantId: DEMO_TENANT_ID, email: user.email });
      if (existing) {
        usersByEmail.set(user.email, existing._id.toString());
        demoActors.set(user.email, { userId: existing._id.toString(), fullName: user.fullName, roleId });
        continue;
      }
      const created = await userAdminService.createUser({
        tenantId: DEMO_TENANT_ID,
        email: user.email,
        fullName: user.fullName,
        password: DEMO_PASSWORD,
        roleId,
        departmentId: user.department ? departmentsByCode.get(user.department) : undefined,
      });
      usersByEmail.set(user.email, created.id);
      demoActors.set(user.email, { userId: created.id, fullName: user.fullName, roleId });
      usersCreated += 1;
    }
    console.log(`✓ users: ${usersCreated} created`);

    // isPlatformAdmin is deliberately not settable via any tenant-facing API (see user.schema.ts) —
    // a direct database write is the documented bootstrap path for it.
    await userModel.updateOne(
      { tenantId: DEMO_TENANT_ID, email: 'admin@demo.local' },
      { $set: { isPlatformAdmin: true } },
    );

    // TRN-5: overdue-training notifications also go to the department head.
    await departmentService.update(DEMO_TENANT_ID, departmentsByCode.get('QA')!, {
      headUserId: usersByEmail.get('qa.head@demo.local')!,
    });
    await departmentService.update(DEMO_TENANT_ID, departmentsByCode.get('PROD')!, {
      headUserId: usersByEmail.get('prod.head@demo.local')!,
    });
    await departmentService.update(DEMO_TENANT_ID, departmentsByCode.get('QC')!, {
      headUserId: usersByEmail.get('qc.head@demo.local')!,
    });

    const existingSchemes = new Set(
      (await schemeModel.find({ tenantId: DEMO_TENANT_ID }).lean()).map((s) => s.entityType),
    );
    let schemesCreated = 0;
    for (const scheme of NUMBERING_SCHEMES) {
      if (existingSchemes.has(scheme.entityType)) continue;
      await numberingService.createScheme({ tenantId: DEMO_TENANT_ID, ...scheme });
      schemesCreated += 1;
    }
    console.log(`✓ numbering schemes (PLT-5): ${schemesCreated} created`);

    const deptHeadRoleId = rolesByName.get('Dept Head')!._id.toString();
    const qaHeadRoleId = rolesByName.get('QA Head')!._id.toString();
    const approvalSteps = [
      { name: 'Dept Head Review', roleId: deptHeadRoleId, signatureMeaning: SignatureMeaning.REVIEWED_BY, rejectToStepIndex: null },
      { name: 'QA Head Approval', roleId: qaHeadRoleId, signatureMeaning: SignatureMeaning.APPROVED_BY, rejectToStepIndex: 0 },
    ];
    const existingTemplates = new Set((await workflowService.listTemplates(DEMO_TENANT_ID)).map((t) => t.entityType));
    let templatesCreated = 0;
    for (const entityType of [DOCUMENT_VERSION_ENTITY_TYPE, TEST_RECORD_ENTITY_TYPE]) {
      if (existingTemplates.has(entityType)) continue;
      await workflowService.createTemplate({
        tenantId: DEMO_TENANT_ID,
        entityType,
        name: entityType === DOCUMENT_VERSION_ENTITY_TYPE ? 'Document Review & Approval' : 'Test Record Approval',
        steps: approvalSteps,
      });
      templatesCreated += 1;
    }
    console.log(`✓ workflow templates (PLT-4, 2-step review → approval): ${templatesCreated} created`);

    // EQP-7: breakdown-triggered maintenance tasks are assigned to this role.
    await tenantService.updateSettings(DEMO_TENANT_ID, {
      maintenanceRoleId: rolesByName.get('Maintenance Engineer')!._id.toString(),
    });
    console.log('✓ tenant settings (maintenance role wired for EQP-7)');

    // ---------------------------------------------------------------------------------------
    // Sample business data — makes a fresh database demo-able immediately, and specifically
    // drives real Documents through the real PLT-4 approval workflow (via real e-signature
    // challenges against DEMO_PASSWORD, never a bypass) so logging in as prod.head/qc.head or
    // qa.head shows something real in "Pending approvals" without any manual setup.
    // Idempotent per item, same convention as the rest of this file: skipped if a record with
    // the same name/title already exists for this tenant.
    // ---------------------------------------------------------------------------------------

    const qaExec = demoActors.get('qa.exec@demo.local')!;
    const prodHead = demoActors.get('prod.head@demo.local')!;
    const qaHead = demoActors.get('qa.head@demo.local')!;

    function dummyPdfFile(label: string): UploadedDocumentFile {
      const buffer = Buffer.from(`%PDF-1.4\n% Seed document — ${label}\n`);
      return { originalname: `${label.toLowerCase().replace(/\s+/g, '-')}.pdf`, mimetype: 'application/pdf', size: buffer.length, buffer };
    }

    // Approves whatever step a document version is currently pending at, via a REAL e-signature
    // challenge (the approver's real, known DEMO_PASSWORD) — not a bypass. The real
    // DocumentWorkflowListener (already wired into the live app) advances the version's state as
    // a side effect, exactly as it would from a real HTTP request.
    async function approveCurrentStep(versionId: string, approver: DemoActor): Promise<void> {
      const instance = await workflowService.findInstanceForEntity(DEMO_TENANT_ID, DOCUMENT_VERSION_ENTITY_TYPE, versionId);
      if (!instance) throw new Error(`Seed: no pending workflow instance for document version ${versionId}`);
      const { signingToken } = await esignService.challenge(approver.userId, DEMO_TENANT_ID, approver.fullName, DEMO_PASSWORD);
      await workflowService.actOnStep(DEMO_TENANT_ID, instance.id, approver, {
        action: WorkflowAction.APPROVE,
        signingToken,
        entitySnapshot: { entityType: DOCUMENT_VERSION_ENTITY_TYPE, entityId: versionId },
      });
    }

    interface DocumentSeed {
      title: string;
      docType: DocumentType;
      departmentCode: string;
      // How far through the approval flow to drive it — gives every pending-approval state a
      // real example: an untouched draft, one pending each workflow step, and one fully Effective.
      stage: 'draft' | 'pending_review' | 'pending_approval' | 'effective';
      distributeToDepartmentCode?: string;
    }

    const DOCUMENT_SEEDS: DocumentSeed[] = [
      { title: 'Gowning Procedure', docType: DocumentType.SOP, departmentCode: 'QA', stage: 'pending_review' },
      { title: 'Equipment Cleaning SOP', docType: DocumentType.SOP, departmentCode: 'QC', stage: 'pending_approval' },
      // Distributed to Production once Effective — auto-generates real TRN-1 TrainingAssignments
      // for prod.head/operator via the same DocumentTrainingTargetChangedEvent a real edit fires.
      { title: 'Change Control Policy', docType: DocumentType.POLICY, departmentCode: 'QA', stage: 'effective', distributeToDepartmentCode: 'PROD' },
      { title: 'Deviation Handling Procedure', docType: DocumentType.SOP, departmentCode: 'PROD', stage: 'draft' },
    ];

    let documentsCreated = 0;
    for (const seedItem of DOCUMENT_SEEDS) {
      const existing = await documentModel.findOne({ tenantId: DEMO_TENANT_ID, title: seedItem.title }).lean();
      if (existing) continue;

      const document = await documentsService.createDocument(
        DEMO_TENANT_ID,
        qaExec,
        {
          title: seedItem.title,
          docType: seedItem.docType,
          departmentId: departmentsByCode.get(seedItem.departmentCode)!,
          reviewFrequencyMonths: 12,
        },
        dummyPdfFile(seedItem.title),
      );

      if (seedItem.stage !== 'draft') {
        await documentsService.submitVersion(DEMO_TENANT_ID, qaExec, document.latestVersion.id);
      }
      if (seedItem.stage === 'pending_approval' || seedItem.stage === 'effective') {
        await approveCurrentStep(document.latestVersion.id, prodHead);
      }
      if (seedItem.stage === 'effective') {
        await approveCurrentStep(document.latestVersion.id, qaHead);
      }
      if (seedItem.distributeToDepartmentCode) {
        await documentsService.updateDistribution(DEMO_TENANT_ID, document.id, {
          roleIds: [],
          departmentIds: [departmentsByCode.get(seedItem.distributeToDepartmentCode)!],
        });
      }
      documentsCreated += 1;
    }
    console.log(`✓ sample documents (approval-flow demo): ${documentsCreated} created`);

    interface EquipmentSeed {
      name: string;
      location: string;
      departmentCode: string;
      isGmpCritical: boolean;
      calibration?: {
        frequencyMonths: number;
        parameters: string;
        toleranceClass: string;
        nextDueDate: string;
        agencyType: 'internal' | 'external';
        agencyName?: string;
      };
    }

    const EQUIPMENT_SEEDS: EquipmentSeed[] = [
      {
        name: 'Autoclave AC-1',
        location: 'Utility Room',
        departmentCode: 'ENG',
        isGmpCritical: true,
        // Deliberately overdue — exercises the QA-dashboard overdue-calibration widget.
        calibration: { frequencyMonths: 12, parameters: 'Temperature, Pressure', toleranceClass: 'Class A', nextDueDate: '2026-06-01', agencyType: 'internal' },
      },
      {
        name: 'pH Meter PM-3',
        location: 'QC Lab — Bench 3',
        departmentCode: 'QC',
        isGmpCritical: false,
        calibration: {
          frequencyMonths: 6,
          parameters: 'pH 4/7/10 buffer verification',
          toleranceClass: 'Class B',
          nextDueDate: '2026-08-05',
          agencyType: 'external',
          agencyName: 'Metro Calibration Services',
        },
      },
      {
        name: 'HPLC System HP-1',
        location: 'QC Lab — Instrument Room',
        departmentCode: 'QC',
        isGmpCritical: true,
        calibration: {
          frequencyMonths: 12,
          parameters: 'Flow rate, wavelength accuracy',
          toleranceClass: 'Class A',
          nextDueDate: '2027-06-01',
          agencyType: 'external',
          agencyName: 'Precision Cal Labs',
        },
      },
      // No calibration schedule at all — exercises the NOT_SCHEDULED status-card stub.
      { name: 'Air Compressor CP-2', location: 'Production Floor', departmentCode: 'PROD', isGmpCritical: false },
    ];

    let equipmentCreated = 0;
    for (const seedItem of EQUIPMENT_SEEDS) {
      const existing = await equipmentModel.findOne({ tenantId: DEMO_TENANT_ID, name: seedItem.name }).lean();
      if (existing) continue;

      const equipment = await equipmentService.create(DEMO_TENANT_ID, {
        name: seedItem.name,
        location: seedItem.location,
        departmentId: departmentsByCode.get(seedItem.departmentCode)!,
        isGmpCritical: seedItem.isGmpCritical,
      });

      if (seedItem.calibration) {
        const schedule: CreateCalibrationScheduleRequest = {
          frequencyMonths: seedItem.calibration.frequencyMonths,
          parameters: seedItem.calibration.parameters,
          toleranceClass: seedItem.calibration.toleranceClass,
          agencyType: seedItem.calibration.agencyType,
          agencyName: seedItem.calibration.agencyName,
          nextDueDate: seedItem.calibration.nextDueDate,
        };
        await calibrationService.upsertSchedule(DEMO_TENANT_ID, equipment.id, qaExec, schedule);
      }
      equipmentCreated += 1;
    }
    console.log(`✓ sample equipment: ${equipmentCreated} created`);

    interface RoomSeed {
      name: string;
      departmentCode: string;
      classification: RoomClassification;
      cleaning: UpsertRoomCleaningScheduleRequest;
    }

    const ROOM_SEEDS: RoomSeed[] = [
      {
        name: 'QC Laboratory',
        departmentCode: 'QC',
        classification: RoomClassification.CONTROLLED,
        cleaning: { routineFrequency: RoomCleaningFrequency.DAILY, fullCleaningIntervalDays: 30, nextRoutineDueDate: '2026-08-01', nextFullDueDate: '2026-08-20' },
      },
      {
        name: 'Production Floor A',
        departmentCode: 'PROD',
        classification: RoomClassification.GENERAL,
        // Deliberately overdue on both dates — exercises the QA-dashboard overdue-cleaning widget.
        cleaning: { routineFrequency: RoomCleaningFrequency.PER_SHIFT, fullCleaningIntervalDays: 14, nextRoutineDueDate: '2026-06-01', nextFullDueDate: '2026-06-15' },
      },
    ];

    let roomsCreated = 0;
    for (const seedItem of ROOM_SEEDS) {
      const existing = await roomModel.findOne({ tenantId: DEMO_TENANT_ID, name: seedItem.name }).lean();
      if (existing) continue;

      const room = await roomService.create(DEMO_TENANT_ID, {
        name: seedItem.name,
        classification: seedItem.classification,
        departmentId: departmentsByCode.get(seedItem.departmentCode)!,
      });
      const cleaningActor: RoomCleaningActor = { userId: qaExec.userId, fullName: qaExec.fullName };
      await roomCleaningService.upsertSchedule(DEMO_TENANT_ID, room.id, cleaningActor, seedItem.cleaning);
      roomsCreated += 1;
    }
    console.log(`✓ sample rooms: ${roomsCreated} created`);

    interface MaterialLotSeed {
      materialName: string;
      manufacturer?: string;
      receivedDate: string;
      finalStatus: MaterialLotStatus;
      note?: string;
    }

    const MATERIAL_LOT_SEEDS: MaterialLotSeed[] = [
      { materialName: 'Lactose Monohydrate', manufacturer: 'DFE Pharma', receivedDate: '2026-07-01', finalStatus: MaterialLotStatus.QUARANTINE },
      { materialName: 'Magnesium Stearate', manufacturer: 'Peter Greven', receivedDate: '2026-06-20', finalStatus: MaterialLotStatus.UNDER_TEST, note: 'Sent for QC testing' },
      { materialName: 'Microcrystalline Cellulose', manufacturer: 'FMC BioPolymer', receivedDate: '2026-06-10', finalStatus: MaterialLotStatus.APPROVED, note: 'Passed all QC tests' },
      { materialName: 'Talc', manufacturer: 'Imerys', receivedDate: '2026-06-05', finalStatus: MaterialLotStatus.REJECTED, note: 'Failed heavy metals test' },
    ];

    let materialLotsCreated = 0;
    for (const seedItem of MATERIAL_LOT_SEEDS) {
      const existing = await lotModel.findOne({ tenantId: DEMO_TENANT_ID, materialName: seedItem.materialName }).lean();
      if (existing) continue;

      const createDto: CreateMaterialLotRequest = {
        materialName: seedItem.materialName,
        manufacturer: seedItem.manufacturer,
        receivedDate: seedItem.receivedDate,
      };
      const lot = await materialLotService.create(DEMO_TENANT_ID, createDto);

      const signingContext: SigningContext = { userId: qaExec.userId, tenantId: DEMO_TENANT_ID, fullName: qaExec.fullName };
      if (seedItem.finalStatus === MaterialLotStatus.UNDER_TEST) {
        await materialLotService.dispositionStatus(DEMO_TENANT_ID, lot.id, signingContext, MaterialLotStatus.UNDER_TEST, seedItem.note);
      } else if (seedItem.finalStatus === MaterialLotStatus.APPROVED) {
        await materialLotService.dispositionStatus(DEMO_TENANT_ID, lot.id, signingContext, MaterialLotStatus.UNDER_TEST, 'Sent for QC testing');
        await materialLotService.dispositionStatus(DEMO_TENANT_ID, lot.id, signingContext, MaterialLotStatus.APPROVED, seedItem.note);
      } else if (seedItem.finalStatus === MaterialLotStatus.REJECTED) {
        await materialLotService.dispositionStatus(DEMO_TENANT_ID, lot.id, signingContext, MaterialLotStatus.REJECTED, seedItem.note);
      }
      materialLotsCreated += 1;
    }
    console.log(`✓ sample material lots: ${materialLotsCreated} created`);

    console.log('');
    console.log('Seed complete.');
    printCredentials();
  } finally {
    await app.close();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
