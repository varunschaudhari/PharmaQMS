import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PmTaskStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type PmTaskDocument = HydratedDocument<PmTask>;

// EQP-9: one auto-generated PM task. The unique (tenantId, planId, dueDate) index is the
// idempotency guard for the daily scanner's auto-generation (a duplicate-key insert attempt
// means "already generated for this due cycle" — never a read-then-write race).
@Schema({ collection: 'pmTasks', timestamps: true })
export class PmTask {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  // Denormalized snapshot at creation (same pattern as EQP-7's MaintenanceTask).
  @Prop({ type: String, required: true })
  equipmentCode!: string;

  @Prop({ type: String, required: true })
  equipmentName!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'PmPlan', required: true })
  planId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(PmTaskStatus), required: true })
  status!: PmTaskStatus;

  @Prop({ type: Date, required: true })
  dueDate!: Date;

  @Prop({ type: String, default: null })
  completionNote!: string | null;

  @Prop({ type: String, default: null })
  completedByUserId!: string | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;
}

export const PmTaskSchema = SchemaFactory.createForClass(PmTask);

PmTaskSchema.index({ tenantId: 1, planId: 1, dueDate: 1 }, { unique: true });
PmTaskSchema.index({ tenantId: 1, status: 1 });
