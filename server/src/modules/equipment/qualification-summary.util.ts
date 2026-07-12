import { QualificationResult, QualificationType } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type { QualificationRecordDocument } from './schemas/qualification-record.schema';

export interface QualificationSummary {
  hasPassedQualification: boolean;
  nextRequalificationDueDate: string | null;
}

const REQUALIFICATION_TYPES = [QualificationType.PQ, QualificationType.REQUALIFICATION];
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// EQP-3/EQP-8: shared by EquipmentService.getStatusCard() (which injects only the
// QualificationRecord MODEL, not QualificationService, to avoid a circular DI dependency — the
// same precedent as EQP-4's CalibrationSchedule model injection) and QualificationService itself.
export async function computeQualificationSummary(
  recordModel: Model<QualificationRecordDocument>,
  tenantId: string,
  equipmentId: string,
): Promise<QualificationSummary> {
  const latestPass = await recordModel
    .findOne({
      tenantId,
      equipmentId,
      qualificationType: { $in: REQUALIFICATION_TYPES },
      result: QualificationResult.PASS,
    })
    .sort({ performedDate: -1 });

  if (!latestPass) {
    return { hasPassedQualification: false, nextRequalificationDueDate: null };
  }
  if (!latestPass.requalificationFrequencyMonths) {
    return { hasPassedQualification: true, nextRequalificationDueDate: null };
  }
  const dueDate = new Date(
    latestPass.performedDate.getTime() + latestPass.requalificationFrequencyMonths * 30 * MILLIS_PER_DAY,
  );
  return { hasPassedQualification: true, nextRequalificationDueDate: dueDate.toISOString() };
}
