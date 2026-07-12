import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type DocumentTrainingTargetDocument = HydratedDocument<DocumentTrainingTarget>;

// TRN-1: a local read-model mirror of exactly what Training needs from the Documents module —
// kept in sync by DocumentTrainingTargetChangedEvent (DOC-9 distribution edits + DOC-3/DOC-6
// effective-version transitions). This is what lets "adding a user to a role" (a PLT-8 event
// with no idea what documents exist) find its matching documents WITHOUT Training depending on
// the Documents module directly (CLAUDE.md: business modules never depend on each other).
@Schema({ collection: 'documentTrainingTargets', timestamps: true })
export class DocumentTrainingTarget {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  documentId!: string;

  @Prop({ required: true, trim: true })
  docNumber!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  // Null until the document has an Effective version — nothing to assign yet.
  @Prop({ type: String, default: null })
  effectiveVersionId!: string | null;

  @Prop({ type: String, default: null })
  effectiveVersionLabel!: string | null;

  @Prop({ type: [String], default: [] })
  distributionRoleIds!: string[];

  @Prop({ type: [String], default: [] })
  distributionDepartmentIds!: string[];
}

export const DocumentTrainingTargetSchema = SchemaFactory.createForClass(DocumentTrainingTarget);

DocumentTrainingTargetSchema.index({ tenantId: 1, documentId: 1 }, { unique: true });
DocumentTrainingTargetSchema.index({ tenantId: 1, distributionRoleIds: 1 });
DocumentTrainingTargetSchema.index({ tenantId: 1, distributionDepartmentIds: 1 });
