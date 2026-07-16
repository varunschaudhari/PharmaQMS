import { NotificationEvent, WhatsAppTemplateKey, type TrainingAssignmentData } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { UserDocument } from '../../../platform/auth/schemas/user.schema';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { TrainingOverdueScanner } from '../training-overdue.scanner';
import type { TrainingService } from '../training.service';

describe('TRN-5 training-overdue due-date scanner', () => {
  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  function overdueAssignment(overrides: Partial<TrainingAssignmentData>): TrainingAssignmentData {
    return {
      id: id(),
      tenantId: 'tenant-1',
      userId: 'user-1',
      userFullName: 'Olive Operator',
      documentId: 'doc-1',
      docNumber: 'SOP-QA-001',
      documentTitle: 'Cleaning of pH meters',
      versionId: 'ver-1',
      versionLabel: '1.0',
      status: 'pending',
      assignedAt: '2026-07-01T00:00:00.000Z',
      dueDate: '2026-07-08T00:00:00.000Z',
      isOverdue: true,
      completedAt: null,
      ...overrides,
    } as TrainingAssignmentData;
  }

  function makeScanner(overdue: TrainingAssignmentData[], users: Partial<UserDocument>[], departments: Partial<DepartmentDocument>[]) {
    const trainingService = { listOverdue: jest.fn().mockResolvedValue(overdue) } as unknown as TrainingService;
    const userModel = { find: jest.fn().mockResolvedValue(users) } as unknown as Model<UserDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return new TrainingOverdueScanner(trainingService, userModel, departmentModel);
  }

  it('TRN-5: registers under a stable key', () => {
    const scanner = makeScanner([], [], []);
    expect(scanner.key).toBe('training.overdue-assignments');
  });

  it('TRN-5: an overdue assignment notifies BOTH the employee and their department head', async () => {
    const assignment = overdueAssignment({ userId: 'user-1' });
    const scanner = makeScanner(
      [assignment],
      [{ _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), departmentId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012') } as unknown as UserDocument],
      [{ _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'), headUserId: 'head-user-1' } as unknown as DepartmentDocument],
    );
    // Align the mocked user's _id with the assignment's userId for the map lookup.
    assignment.userId = '507f1f77bcf86cd799439011';

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });

    expect(findings).toHaveLength(2);
    const employeeFinding = findings.find((f) => f.userId === '507f1f77bcf86cd799439011');
    const headFinding = findings.find((f) => f.userId === 'head-user-1');
    expect(employeeFinding).toBeDefined();
    expect(headFinding).toBeDefined();
    expect(employeeFinding!.event).toBe(NotificationEvent.OVERDUE);
    expect(headFinding!.title).toContain('Team training overdue');
    // Same logical fact, different recipients — the compound dedupe index scopes by userId.
    expect(employeeFinding!.dedupeKey).toBe(headFinding!.dedupeKey);

    // PLT-6-WA: both recipients get the SAME TRAINING_OVERDUE template/params — the template
    // always describes the trainee, regardless of who receives it.
    expect(employeeFinding!.whatsapp).toEqual({
      templateKey: WhatsAppTemplateKey.TRAINING_OVERDUE,
      params: ['Olive Operator', 'SOP-QA-001', 'Cleaning of pH meters'],
    });
    expect(headFinding!.whatsapp).toEqual(employeeFinding!.whatsapp);
  });

  it('TRN-5: no department (or no head configured) produces only the employee finding', async () => {
    const assignment = overdueAssignment({ userId: 'lone-user' });
    const scanner = makeScanner(
      [assignment],
      [{ _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'), departmentId: null } as unknown as UserDocument],
      [],
    );
    assignment.userId = '507f1f77bcf86cd799439013';

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('507f1f77bcf86cd799439013');
  });

  it('TRN-5: a department head who IS the overdue employee is not double-notified', async () => {
    const userId = '507f1f77bcf86cd799439014';
    const assignment = overdueAssignment({ userId });
    const scanner = makeScanner(
      [assignment],
      [{ _id: new mongoose.Types.ObjectId(userId), departmentId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439015') } as unknown as UserDocument],
      [{ _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439015'), headUserId: userId } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toHaveLength(1);
  });

  it('TRN-5: no overdue assignments produces no findings (and skips the user/department lookups)', async () => {
    const scanner = makeScanner([], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });
});
