import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CalibrationRecordStatus, CalibrationResult } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type CalibrationRecordDocument = HydratedDocument<CalibrationRecord>;

// EQP-4/EQP-5: one performed calibration event. Regulated entity: no hard delete or edits after
// creation (Iron Rule 3) — the only permitted mutations are the QA verify/disposition sign-off
// fields, each set exactly once by its own e-signature endpoint.
@Schema({ collection: 'calibrationRecords', timestamps: true })
export class CalibrationRecord {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'CalibrationSchedule', required: true })
  scheduleId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  performedDate!: Date;

  @Prop({ type: String, enum: Object.values(CalibrationResult), required: true })
  result!: CalibrationResult;

  // Immutable object-storage key (common/storage) — one certificate upload per record.
  @Prop({ required: true })
  certificateFileKey!: string;

  @Prop({ required: true })
  certificateFileName!: string;

  @Prop({ required: true })
  certificateContentType!: string;

  @Prop({ type: String, default: null })
  toleranceNotes!: string | null;

  // EQP-5: mandatory when result is FAIL.
  @Prop({ type: String, default: null })
  impactAssessmentNote!: string | null;

  @Prop({ type: String, enum: Object.values(CalibrationRecordStatus), required: true })
  status!: CalibrationRecordStatus;

  // Phase 2 placeholder (EQP-5) — nullable until a Deviations module exists.
  @Prop({ type: String, default: null })
  deviationRef!: string | null;

  @Prop({ type: String, required: true })
  recordedByUserId!: string;
}

export const CalibrationRecordSchema = SchemaFactory.createForClass(CalibrationRecord);

CalibrationRecordSchema.index({ tenantId: 1, equipmentId: 1, performedDate: -1 });
