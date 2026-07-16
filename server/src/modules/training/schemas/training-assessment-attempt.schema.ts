import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { applyAppendOnly } from '../../../common/database/append-only.plugin';

@Schema({ _id: false })
export class TrainingAssessmentAttemptAnswer {
  @Prop({ type: String, required: true })
  questionId!: string;

  @Prop({ type: Number, required: true })
  selectedOptionIndex!: number;
}

const TrainingAssessmentAttemptAnswerSchema = SchemaFactory.createForClass(TrainingAssessmentAttemptAnswer);

export type TrainingAssessmentAttemptDocument = HydratedDocument<TrainingAssessmentAttempt>;

// TRN-6: one immutable quiz attempt — score, answers, and timestamp, audited and never editable
// (Iron Rule 3-adjacent, same append-only guarantee as auditEvents/signatures/logbookEntries).
@Schema({ collection: 'trainingAssessmentAttempts', timestamps: false })
export class TrainingAssessmentAttempt {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  assignmentId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  assessmentId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: Number, required: true })
  attemptNumber!: number;

  @Prop({ type: [TrainingAssessmentAttemptAnswerSchema], required: true })
  answers!: Types.DocumentArray<TrainingAssessmentAttemptAnswer>;

  @Prop({ type: Number, required: true })
  scorePercentage!: number;

  @Prop({ type: Boolean, required: true })
  passed!: boolean;

  // Server UTC timestamp only (Iron Rule 6) — set explicitly, not via `timestamps: true`, since
  // this collection has no updatedAt (attempts are never updated).
  @Prop({ type: Date, required: true, default: () => new Date() })
  occurredAt!: Date;
}

export const TrainingAssessmentAttemptSchema = SchemaFactory.createForClass(TrainingAssessmentAttempt);

TrainingAssessmentAttemptSchema.index({ tenantId: 1, assignmentId: 1, occurredAt: -1 });

// TRN-6: attempts are immutable — enforced at the Mongoose layer, not just convention.
applyAppendOnly(TrainingAssessmentAttemptSchema, 'trainingAssessmentAttempts is append-only: attempts are never edited or deleted.');
