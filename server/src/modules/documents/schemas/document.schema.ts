import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DocumentType } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type DocumentEntityDocument = HydratedDocument<DocumentEntity>;

// DOC-1: the logical controlled document — SOP, specification, protocol, format, or policy.
// Versions (the files + lifecycle states) live in documentVersions; this holds the identity and
// metadata. Regulated entity: no hard delete (Iron Rule 3) — obsolescence is a version state.
// Named DocumentEntity because `Document` collides with the DOM lib type TypeScript loads.
@Schema({ collection: 'documents', timestamps: true })
export class DocumentEntity {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // PLT-5: e.g. SOP-QA-001 — assigned by the numbering service at creation, never inline.
  @Prop({ required: true, trim: true })
  docNumber!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ type: String, enum: Object.values(DocumentType), required: true })
  docType!: DocumentType;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Department', required: true })
  departmentId!: Types.ObjectId;

  // DOC-6: periodic review cadence, in months from the effective/last-reaffirmed date.
  @Prop({ type: Number, required: true })
  reviewFrequencyMonths!: number;

  @Prop({ type: String, required: true })
  authorId!: string;

  // DOC-6: set when a periodic review reaffirms the document; next review due =
  // max(effectiveDate, lastReviewedAt) + reviewFrequencyMonths.
  @Prop({ type: Date, default: null })
  lastReviewedAt!: Date | null;

  // DOC-9: which roles/departments must be trained on this document (TRN-1's mapping source).
  @Prop({ type: [String], default: [] })
  distributionRoleIds!: string[];

  @Prop({ type: [String], default: [] })
  distributionDepartmentIds!: string[];
}

export const DocumentEntitySchema = SchemaFactory.createForClass(DocumentEntity);

// Iron Rule 5: every compound index starts with tenantId.
DocumentEntitySchema.index({ tenantId: 1, docNumber: 1 }, { unique: true });
DocumentEntitySchema.index({ tenantId: 1, docType: 1 });
