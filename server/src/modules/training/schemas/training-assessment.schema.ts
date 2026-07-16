import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TrainingAssessmentStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ _id: true, timestamps: false })
export class TrainingAssessmentQuestion {
  @Prop({ required: true, trim: true })
  questionText!: string;

  @Prop({ type: [String], required: true })
  options!: string[];

  @Prop({ type: Number, required: true })
  correctOptionIndex!: number;
}

const TrainingAssessmentQuestionSchema = SchemaFactory.createForClass(TrainingAssessmentQuestion);

export type TrainingAssessmentDocument = HydratedDocument<TrainingAssessment>;

// TRN-6: the MCQ question bank attached to one document VERSION (Training-owned — `documentId`/
// `versionId` are opaque string references into the Documents module, never a Mongoose `ref`,
// same polymorphic-reference precedent as TrainingAssignment's own documentId/versionId fields;
// CLAUDE.md: business modules never depend on each other directly).
@Schema({ collection: 'trainingAssessments', timestamps: true })
export class TrainingAssessment {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  documentId!: string;

  @Prop({ type: String, required: true })
  versionId!: string;

  @Prop({ required: true, trim: true })
  docNumber!: string;

  @Prop({ required: true, trim: true })
  versionLabel!: string;

  @Prop({ type: String, enum: Object.values(TrainingAssessmentStatus), required: true, default: TrainingAssessmentStatus.DRAFT })
  status!: TrainingAssessmentStatus;

  @Prop({ type: [TrainingAssessmentQuestionSchema], required: true })
  questions!: Types.DocumentArray<TrainingAssessmentQuestion>;

  // Null for a system-generated carry-forward copy (see TrainingAssessmentService.carryForward).
  @Prop({ type: String, default: null })
  createdByUserId!: string | null;

  @Prop({ type: String, default: null })
  approvedByUserId!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;
}

export const TrainingAssessmentSchema = SchemaFactory.createForClass(TrainingAssessment);

// One assessment per document version (Iron Rule 5: tenantId leads every compound index).
TrainingAssessmentSchema.index({ tenantId: 1, versionId: 1 }, { unique: true });
TrainingAssessmentSchema.index({ tenantId: 1, documentId: 1 });
