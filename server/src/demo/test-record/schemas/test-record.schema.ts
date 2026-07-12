import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type TestRecordDocument = HydratedDocument<TestRecord>;

// Phase 0 gate (SPEC.md §8): throwaway demo entity exercising every platform service together.
// Deliberately OUTSIDE server/src/modules/ — the phase-gated modules tree stays reserved for
// DOC/TRN/EQP; this whole folder is deleted once real modules cover the same integrations.
@Schema({ collection: 'testRecords', timestamps: true })
export class TestRecord {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // PLT-5: assigned by the numbering service — never generated inline (CLAUDE.md conventions).
  @Prop({ required: true, trim: true })
  recordNumber!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ type: String, required: true })
  createdByUserId!: string;
}

export const TestRecordSchema = SchemaFactory.createForClass(TestRecord);

// Iron Rule 5: every compound index starts with tenantId.
TestRecordSchema.index({ tenantId: 1, recordNumber: 1 }, { unique: true });
