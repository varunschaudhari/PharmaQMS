import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MaintenanceTaskStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MaintenanceTaskDocument = HydratedDocument<MaintenanceTask>;

// EQP-7: a maintenance task auto-created from a BREAKDOWN logbook entry (SPEC.md §7.3). Its
// closure/verification fields are the only permitted mutations — no hard delete (Iron Rule 3).
@Schema({ collection: 'maintenanceTasks', timestamps: true })
export class MaintenanceTask {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  // Denormalized snapshot at creation (same pattern as TRN-1's TrainingAssignment.docNumber).
  @Prop({ type: String, required: true })
  equipmentCode!: string;

  @Prop({ type: String, required: true })
  equipmentName!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'LogbookEntry', required: true })
  sourceLogbookEntryId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(MaintenanceTaskStatus), required: true })
  status!: MaintenanceTaskStatus;

  // Snapshot of Tenant.settings.maintenanceRoleId at creation time.
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  assignedRoleId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  engineerCompletionNote!: string | null;

  @Prop({ type: String, default: null })
  completedByUserId!: string | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  // Snapshot of Tenant.settings.requireMaintenanceVerification at creation time — a later tenant
  // setting change never silently reinterprets an in-flight task's requirement.
  @Prop({ type: Boolean, required: true })
  verificationRequired!: boolean;

  @Prop({ type: String, default: null })
  verifiedByUserId!: string | null;

  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;

  @Prop({ type: String, default: null })
  verificationNote!: string | null;
}

export const MaintenanceTaskSchema = SchemaFactory.createForClass(MaintenanceTask);

MaintenanceTaskSchema.index({ tenantId: 1, status: 1 });
MaintenanceTaskSchema.index({ tenantId: 1, equipmentId: 1 });
