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
  PermissionAction,
  PermissionModule,
  SignatureMeaning,
  type PermissionKey,
} from '@pharmaqms/shared';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { TEST_RECORD_ENTITY_TYPE, TEST_RECORD_NUMBERING_TYPE } from '../demo/test-record/test-record.service';
import { DOCUMENT_VERSION_ENTITY_TYPE } from '../modules/documents/document-entity-types';
import { EQUIPMENT_NUMBERING_TYPE } from '../modules/equipment/equipment-entity-types';
import { MATERIAL_LOT_NUMBERING_TYPE } from '../modules/materials/material-lot-entity-types';
import { ROOM_NUMBERING_TYPE } from '../modules/rooms/room-entity-types';
import { Role, RoleDocument } from '../platform/auth/schemas/role.schema';
import { User, UserDocument } from '../platform/auth/schemas/user.schema';
import { NumberingService } from '../platform/numbering/numbering.service';
import { NumberingScheme, NumberingSchemeDocument } from '../platform/numbering/schemas/numbering-scheme.schema';
import { DepartmentService } from '../platform/tenant/department.service';
import { Tenant, TenantDocument } from '../platform/tenant/schemas/tenant.schema';
import { TenantService } from '../platform/tenant/tenant.service';
import { UserAdminService } from '../platform/tenant/user-admin.service';
import { WorkflowService } from '../platform/workflow/workflow.service';

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
  { email: 'operator@demo.local', fullName: 'Omkar Patil', role: 'Operator', department: 'PROD' },
  { email: 'maintenance@demo.local', fullName: 'Manoj Iyer', role: 'Maintenance Engineer', department: 'ENG' },
];

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
    const tenantService = app.get(TenantService);
    const departmentService = app.get(DepartmentService);
    const userAdminService = app.get(UserAdminService);
    const numberingService = app.get(NumberingService);
    const workflowService = app.get(WorkflowService);

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
    let usersCreated = 0;
    for (const user of USERS) {
      const role = rolesByName.get(user.role);
      if (!role) throw new Error(`Unknown role "${user.role}"`);
      const existing = await userModel.findOne({ tenantId: DEMO_TENANT_ID, email: user.email });
      if (existing) {
        usersByEmail.set(user.email, existing._id.toString());
        continue;
      }
      const created = await userAdminService.createUser({
        tenantId: DEMO_TENANT_ID,
        email: user.email,
        fullName: user.fullName,
        password: DEMO_PASSWORD,
        roleId: role._id.toString(),
        departmentId: user.department ? departmentsByCode.get(user.department) : undefined,
      });
      usersByEmail.set(user.email, created.id);
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
