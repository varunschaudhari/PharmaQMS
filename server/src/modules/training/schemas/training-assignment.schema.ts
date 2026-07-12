import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TrainingAssignmentStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type TrainingAssignmentDocument = HydratedDocument<TrainingAssignment>;

// TRN-1/TRN-2/TRN-3: one employee's obligation to read-and-understand one document version.
// docNumber/documentTitle/versionLabel are denormalized snapshots from the training-target
// event (Training never queries the Documents module's own schema — CLAUDE.md: business
// modules never depend on one another directly).
//
// A PENDING row is retargeted IN PLACE when a newer Effective version arrives (versionId bumps,
// assignedAt resets) rather than duplicated — there is only ever one open task per (user,
// document). A COMPLETED row is never touched again: Iron Rule 3, it IS the audit record.
@Schema({ collection: 'trainingAssignments', timestamps: true })
export class TrainingAssignment {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  documentId!: string;

  @Prop({ required: true, trim: true })
  docNumber!: string;

  @Prop({ required: true, trim: true })
  documentTitle!: string;

  @Prop({ type: String, required: true })
  versionId!: string;

  @Prop({ required: true })
  versionLabel!: string;

  @Prop({ type: String, enum: Object.values(TrainingAssignmentStatus), required: true })
  status!: TrainingAssignmentStatus;

  @Prop({ type: Date, required: true })
  assignedAt!: Date;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;
}

export const TrainingAssignmentSchema = SchemaFactory.createForClass(TrainingAssignment);

TrainingAssignmentSchema.index({ tenantId: 1, userId: 1, documentId: 1 });
// At most one PENDING assignment per (tenant, user, document) — the atomic guard that makes
// "retarget in place instead of duplicate" race-safe.
TrainingAssignmentSchema.index(
  { tenantId: 1, userId: 1, documentId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
TrainingAssignmentSchema.index({ tenantId: 1, status: 1, assignedAt: 1 });
