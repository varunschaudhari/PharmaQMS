import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type CalibrationScheduleDocument = HydratedDocument<CalibrationSchedule>;

// EQP-4: one active recurring calibration schedule per equipment (SPEC.md §7.3). nextDueDate is
// the single source of truth for the status card's calibration indicator and the daily scanner;
// it is set at creation and recomputed only when a PASS result is QA-verified.
@Schema({ collection: 'calibrationSchedules', timestamps: true })
export class CalibrationSchedule {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  frequencyMonths!: number;

  @Prop({ required: true, trim: true })
  parameters!: string;

  @Prop({ required: true, trim: true })
  toleranceClass!: string;

  @Prop({ type: String, enum: ['internal', 'external'], required: true })
  agencyType!: 'internal' | 'external';

  @Prop({ type: String, default: null, trim: true })
  agencyName!: string | null;

  // EQP-11: optional link to a CalibrationAgency master record when agencyType is 'external' —
  // a real same-module Mongoose reference (see calibration-agency.schema.ts's header comment).
  // `agencyName` is kept as a free-text fallback for schedules never linked to a master record.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'CalibrationAgency', default: null })
  agencyId!: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  nextDueDate!: Date;
}

export const CalibrationScheduleSchema = SchemaFactory.createForClass(CalibrationSchedule);

// Iron Rule 5 + EQP-4: one schedule per equipment.
CalibrationScheduleSchema.index({ tenantId: 1, equipmentId: 1 }, { unique: true });
CalibrationScheduleSchema.index({ tenantId: 1, nextDueDate: 1 });
