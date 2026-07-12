import { NotificationEvent } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { EquipmentPmScanner } from '../equipment-pm.scanner';
import type { PmService } from '../pm.service';
import type { PmPlanDocument } from '../schemas/pm-plan.schema';
import type { EquipmentDocument } from '../schemas/equipment.schema';

describe('EQP-9 equipment-pm due-date scanner (auto task generation)', () => {
  const objId = (hex: string) => new mongoose.Types.ObjectId(hex);

  function makeScanner(
    plans: Array<Partial<PmPlanDocument>>,
    equipment: Array<Partial<EquipmentDocument>>,
    departments: Array<Partial<DepartmentDocument>>,
    generateTaskIfDue = jest.fn().mockResolvedValue(null),
  ) {
    const pmService = {
      listAllPlans: jest.fn().mockResolvedValue(plans),
      generateTaskIfDue,
    } as unknown as PmService;
    const equipmentModel = { find: jest.fn().mockResolvedValue(equipment) } as unknown as Model<EquipmentDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return { scanner: new EquipmentPmScanner(pmService, equipmentModel, departmentModel), pmService };
  }

  it('EQP-9: registers under a stable key', () => {
    const { scanner } = makeScanner([], [], []);
    expect(scanner.key).toBe('equipment.pm-due');
  });

  it('EQP-9: an overdue plan triggers auto task generation AND notifies the department head', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439041');
    const departmentId = objId('507f1f77bcf86cd799439042');
    const generateTaskIfDue = jest.fn().mockResolvedValue({ id: 'task-1' });
    const { scanner, pmService } = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2026-01-01T00:00:00.000Z') } as unknown as PmPlanDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0020', name: 'Compressor', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-1' } as unknown as DepartmentDocument],
      generateTaskIfDue,
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(pmService.generateTaskIfDue).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('head-user-1');
    expect(findings[0].event).toBe(NotificationEvent.OVERDUE);
  });

  it('EQP-9: a plan due soon (within 30 days) notifies but does NOT yet generate a task', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439043');
    const departmentId = objId('507f1f77bcf86cd799439044');
    const now = new Date('2026-07-11T00:00:00.000Z');
    const dueSoon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const { scanner, pmService } = makeScanner(
      [{ equipmentId, nextDueDate: dueSoon } as unknown as PmPlanDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0021', name: 'Chiller', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-2' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now });
    expect(pmService.generateTaskIfDue).not.toHaveBeenCalled();
    expect(findings).toHaveLength(1);
    expect(findings[0].event).toBe(NotificationEvent.DUE_SOON);
  });

  it('EQP-9: a plan that is still VALID produces no finding and no task', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439045');
    const departmentId = objId('507f1f77bcf86cd799439046');
    const { scanner, pmService } = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2099-01-01T00:00:00.000Z') } as unknown as PmPlanDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0022', name: 'Freezer', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-3' } as unknown as DepartmentDocument],
    );
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(pmService.generateTaskIfDue).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });

  it('EQP-9: no plans produces no findings (and skips the equipment/department lookups)', async () => {
    const { scanner } = makeScanner([], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });
});
