import { NotificationEvent } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { EquipmentQualificationScanner } from '../equipment-qualification.scanner';
import type { EquipmentDocument } from '../schemas/equipment.schema';
import type { QualificationService } from '../qualification.service';

describe('EQP-8 equipment-requalification due-date scanner', () => {
  const objId = (hex: string) => new mongoose.Types.ObjectId(hex);

  function makeScanner(
    schedule: Array<{ equipmentId: string; nextRequalificationDueDate: string }>,
    equipment: Array<Partial<EquipmentDocument>>,
    departments: Array<Partial<DepartmentDocument>>,
  ) {
    const qualificationService = { listRequalificationSchedule: jest.fn().mockResolvedValue(schedule) } as unknown as QualificationService;
    const equipmentModel = { find: jest.fn().mockResolvedValue(equipment) } as unknown as Model<EquipmentDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return new EquipmentQualificationScanner(qualificationService, equipmentModel, departmentModel);
  }

  it('EQP-8: registers under a stable key', () => {
    const scanner = makeScanner([], [], []);
    expect(scanner.key).toBe('equipment.requalification-due');
  });

  it('EQP-8: an overdue requalification notifies the department head', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439031');
    const departmentId = objId('507f1f77bcf86cd799439032');
    const scanner = makeScanner(
      [{ equipmentId: equipmentId.toString(), nextRequalificationDueDate: '2026-01-01T00:00:00.000Z' }],
      [{ _id: equipmentId, equipmentCode: 'EQP-0010', name: 'Autoclave', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-1' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('head-user-1');
    expect(findings[0].event).toBe(NotificationEvent.OVERDUE);
    expect(findings[0].title).toContain('Requalification overdue');
  });

  it('EQP-8: a requalification due within 30 days produces a DUE_SOON finding', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439033');
    const departmentId = objId('507f1f77bcf86cd799439034');
    const now = new Date('2026-07-11T00:00:00.000Z');
    const dueSoon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const scanner = makeScanner(
      [{ equipmentId: equipmentId.toString(), nextRequalificationDueDate: dueSoon.toISOString() }],
      [{ _id: equipmentId, equipmentCode: 'EQP-0011', name: 'Balance', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-2' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now });
    expect(findings).toHaveLength(1);
    expect(findings[0].event).toBe(NotificationEvent.DUE_SOON);
  });

  it('EQP-8: no configured department head produces no finding', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439035');
    const departmentId = objId('507f1f77bcf86cd799439036');
    const scanner = makeScanner(
      [{ equipmentId: equipmentId.toString(), nextRequalificationDueDate: '2026-01-01T00:00:00.000Z' }],
      [{ _id: equipmentId, equipmentCode: 'EQP-0012', name: 'Oven', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: null } as unknown as DepartmentDocument],
    );
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('EQP-8: an empty schedule produces no findings (and skips the equipment/department lookups)', async () => {
    const scanner = makeScanner([], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });
});
