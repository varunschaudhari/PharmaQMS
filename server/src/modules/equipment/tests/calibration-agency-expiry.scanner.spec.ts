import { NotificationEvent } from '@pharmaqms/shared';
import mongoose, { Model } from 'mongoose';
import { DepartmentDocument } from '../../../platform/tenant/schemas/department.schema';
import { CalibrationAgencyExpiryScanner } from '../calibration-agency-expiry.scanner';
import type { CalibrationAgencyDocument } from '../schemas/calibration-agency.schema';
import type { CalibrationScheduleDocument } from '../schemas/calibration-schedule.schema';
import type { EquipmentDocument } from '../schemas/equipment.schema';

describe('EQP-11 calibration-agency accreditation-expiry due-date scanner', () => {
  const objId = (hex: string) => new mongoose.Types.ObjectId(hex);

  function makeScanner(
    agencies: Array<Partial<CalibrationAgencyDocument>>,
    schedules: Array<Partial<CalibrationScheduleDocument>>,
    equipment: Array<Partial<EquipmentDocument>>,
    departments: Array<Partial<DepartmentDocument>>,
  ) {
    const agencyModel = { find: jest.fn().mockResolvedValue(agencies) } as unknown as Model<CalibrationAgencyDocument>;
    const scheduleModel = { find: jest.fn().mockResolvedValue(schedules) } as unknown as Model<CalibrationScheduleDocument>;
    const equipmentModel = { find: jest.fn().mockResolvedValue(equipment) } as unknown as Model<EquipmentDocument>;
    const departmentModel = { find: jest.fn().mockResolvedValue(departments) } as unknown as Model<DepartmentDocument>;
    return new CalibrationAgencyExpiryScanner(agencyModel, scheduleModel, equipmentModel, departmentModel);
  }

  it('EQP-11: registers under a stable key', () => {
    const scanner = makeScanner([], [], [], []);
    expect(scanner.key).toBe('equipment.calibration-agency-accreditation-expired');
  });

  it('EQP-11 (d): an expired agency notifies the department head of every linked equipment (deduped per department)', async () => {
    const agencyId = objId('507f1f77bcf86cd799439021');
    const equipmentId = objId('507f1f77bcf86cd799439022');
    const departmentId = objId('507f1f77bcf86cd799439023');
    const scanner = makeScanner(
      [{ _id: agencyId, name: 'Lapsed Cal Co', accreditationValidUntil: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationAgencyDocument],
      [{ agencyId, equipmentId } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0001', name: 'pH Meter', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: 'head-user-1' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });

    expect(findings).toHaveLength(1);
    expect(findings[0].userId).toBe('head-user-1');
    expect(findings[0].event).toBe(NotificationEvent.OVERDUE);
    expect(findings[0].title).toContain('Lapsed Cal Co');
  });

  it('EQP-11: no expired agencies produces no findings (and skips the schedule/equipment/department lookups)', async () => {
    const scanner = makeScanner([], [], [], []);
    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date() });
    expect(findings).toEqual([]);
  });

  it('EQP-11: two pieces of equipment in the same department under the same expired agency produce only ONE finding', async () => {
    const agencyId = objId('507f1f77bcf86cd799439024');
    const equipmentId1 = objId('507f1f77bcf86cd799439025');
    const equipmentId2 = objId('507f1f77bcf86cd799439026');
    const departmentId = objId('507f1f77bcf86cd799439027');
    const scanner = makeScanner(
      [{ _id: agencyId, name: 'Lapsed Cal Co', accreditationValidUntil: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationAgencyDocument],
      [
        { agencyId, equipmentId: equipmentId1 } as unknown as CalibrationScheduleDocument,
        { agencyId, equipmentId: equipmentId2 } as unknown as CalibrationScheduleDocument,
      ],
      [
        { _id: equipmentId1, equipmentCode: 'EQP-0002', name: 'Balance', departmentId } as unknown as EquipmentDocument,
        { _id: equipmentId2, equipmentCode: 'EQP-0003', name: 'Centrifuge', departmentId } as unknown as EquipmentDocument,
      ],
      [{ _id: departmentId, headUserId: 'head-user-2' } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toHaveLength(1);
  });

  it('EQP-11: a schedule whose equipment has no configured department head produces no finding', async () => {
    const agencyId = objId('507f1f77bcf86cd799439028');
    const equipmentId = objId('507f1f77bcf86cd799439029');
    const departmentId = objId('507f1f77bcf86cd799439030');
    const scanner = makeScanner(
      [{ _id: agencyId, name: 'Lapsed Cal Co', accreditationValidUntil: new Date('2026-01-01T00:00:00.000Z') } as unknown as CalibrationAgencyDocument],
      [{ agencyId, equipmentId } as unknown as CalibrationScheduleDocument],
      [{ _id: equipmentId, equipmentCode: 'EQP-0004', name: 'Autoclave', departmentId } as unknown as EquipmentDocument],
      [{ _id: departmentId, headUserId: null } as unknown as DepartmentDocument],
    );

    const findings = await scanner.scan({ tenantId: 'tenant-1', runDate: '2026-07-11', now: new Date('2026-07-11T00:00:00.000Z') });
    expect(findings).toEqual([]);
  });
});
