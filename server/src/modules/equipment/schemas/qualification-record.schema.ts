import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { QualificationResult, QualificationType } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type QualificationRecordDocument = HydratedDocument<QualificationRecord>;

// EQP-8: one IQ/OQ/PQ/REQUALIFICATION event (SPEC.md §7.3). Regulated entity: no hard delete or
// edits after creation (Iron Rule 3) — the only permitted mutation is attaching the formal
// report after the fact (protocol execution commonly precedes the written report), via its own
// dedicated endpoint/method, exactly once.
@Schema({ collection: 'qualificationRecords', timestamps: true })
export class QualificationRecord {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(QualificationType), required: true })
  qualificationType!: QualificationType;

  @Prop({ type: Date, required: true })
  performedDate!: Date;

  @Prop({ type: String, enum: Object.values(QualificationResult), required: true })
  result!: QualificationResult;

  @Prop({ required: true })
  protocolFileKey!: string;

  @Prop({ required: true })
  protocolFileName!: string;

  @Prop({ required: true })
  protocolContentType!: string;

  // Nullable — the formal report commonly follows the protocol execution; see attachReport().
  @Prop({ type: String, default: null })
  reportFileKey!: string | null;

  @Prop({ type: String, default: null })
  reportFileName!: string | null;

  @Prop({ type: String, default: null })
  reportContentType!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  // Only meaningful on a PASSed PQ/REQUALIFICATION — drives the next requalification due date.
  @Prop({ type: Number, default: null })
  requalificationFrequencyMonths!: number | null;

  @Prop({ type: String, required: true })
  recordedByUserId!: string;
}

export const QualificationRecordSchema = SchemaFactory.createForClass(QualificationRecord);

QualificationRecordSchema.index({ tenantId: 1, equipmentId: 1, performedDate: -1 });
