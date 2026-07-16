import { NotificationEvent, WhatsAppTemplateKey } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { EquipmentCalibrationScanner } from '../equipment-calibration.scanner';
import type { CalibrationScheduleDocument } from '../schemas/calibration-schedule.schema';
import type { EquipmentDocument } from '../schemas/equipment.schema';

describe('EQP-4 equipment-calibration due-date scanner', () => {
  const objId = (hex: string) => new mongoose.Types.ObjectId(hex);

  function makeScanner(
    schedules: Array<Partial<CalibrationScheduleDocument>>,
    equipment: Array<Partial<EquipmentDocument>>,
    departments: Array<Partial<DepartmentDocument>>,
  ) {
    const scheduleModel = { find: jest.fn().mockResolvedValue(schedules) } as unknown as Model<CalibrationScheduleDocument>;
    const equipmentModel = { find: jest.fn().mockResolvedValue(equipment) } as unknown as Model<EquipmentDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return new EquipmentCalibrationScanner(scheduleModel, equipmentModel, departmentModel);
  }

  it('EQP-4: registers under a stable key', () => {
    const scanner = makeScanner([], [], []);
    expect(scanner.key).toBe('equipment.calibration-due');
  });

  it('EQP-4: an overdue schedule notifies the department head (not the operator)', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439021');
    const departmentId = objId('507f1f77bcf86cd799439022');
    const scanner = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0001', name: 'pH Meter', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-1' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });

    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('head-user-1');
    expect(findings[0].event).toBe(NotificationEvent.OVERDUE);
    expect(findings[0].entityId).toBe(equipmentId.toString());
    expect(findings[0].title).toContain('overdue');
  });

  it('PLT-6-WA: an overdue finding carries a CALIBRATION_OVERDUE WhatsApp template with equipmentCode/name/dueDate params', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439029');
    const departmentId = objId('507f1f77bcf86cd799439030');
    const scanner = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0005', name: 'pH Meter', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-4' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });

    expect(findings[0].whatsapp).toEqual({
      templateKey: WhatsAppTemplateKey.CALIBRATION_OVERDUE,
      params: ['EQP-0005', 'pH Meter', '2026-01-01'],
    });
  });

  it('EQP-4: a schedule with no configured department head produces no finding', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439023');
    const departmentId = objId('507f1f77bcf86cd799439024');
    const scanner = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0002', name: 'Balance', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: null } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('EQP-4: a schedule that is still VALID (far in the future) produces no finding', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439025');
    const departmentId = objId('507f1f77bcf86cd799439026');
    const scanner = makeScanner(
      [{ equipmentId, nextDueDate: new Date('2099-01-01T00:00:00.000Z') } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0003', name: 'Autoclave', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-2' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });

  it('EQP-4: no schedules produces no findings (and skips the equipment/department lookups)', async () => {
    const scanner = makeScanner([], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });

  it('EQP-4: a DUE_SOON schedule (within 30 days) notifies with a due_soon event', async () => {
    const equipmentId = objId('507f1f77bcf86cd799439027');
    const departmentId = objId('507f1f77bcf86cd799439028');
    const now = new Date('2026-07-11T00:00:00.000Z');
    const dueSoon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const scanner = makeScanner(
      [{ equipmentId, nextDueDate: dueSoon } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0004', name: 'Centrifuge', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-3' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now });
    expect(findings).toHaveLength(1);
    expect(findings[0].event).toBe(NotificationEvent.DUE_SOON);
  });
});
