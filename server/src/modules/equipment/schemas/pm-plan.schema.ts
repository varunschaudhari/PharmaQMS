import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type PmPlanDocument = HydratedDocument<PmPlan>;

// EQP-9: the recurring preventive-maintenance schedule — one active plan per equipment (mirrors
// EQP-4's CalibrationSchedule shape/lifecycle exactly).
@Schema({ collection: 'pmPlans', timestamps: true })
export class PmPlan {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  frequencyMonths!: number;

  @Prop({ required: true, trim: true })
  checklistText!: string;

  @Prop({ type: Date, required: true })
  nextDueDate!: Date;
}

export const PmPlanSchema = SchemaFactory.createForClass(PmPlan);

PmPlanSchema.index({ tenantId: 1, equipmentId: 1 }, { unique: true });
PmPlanSchema.index({ tenantId: 1, nextDueDate: 1 });
