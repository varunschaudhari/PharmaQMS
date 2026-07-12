import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DocumentVersionState } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type DocumentVersionDocument = HydratedDocument<DocumentVersion>;

// DOC-2: one immutable file per version; lifecycle state lives here. State is only ever changed
// through DocumentsService.transitionVersion(), which enforces the shared transition map —
// never by writing this field directly.
@Schema({ collection: 'documentVersions', timestamps: true })
export class DocumentVersion {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'DocumentEntity', required: true })
  documentId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  majorVersion!: number;

  @Prop({ type: Number, required: true })
  minorVersion!: number;

  @Prop({ type: String, enum: Object.values(DocumentVersionState), required: true })
  state!: DocumentVersionState;

  // DOC-8: mandatory on every version after the first; null only on 1.0.
  @Prop({ type: String, default: null })
  changeSummary!: string | null;

  // Immutable object-storage key (see common/storage) — one upload at version creation, never
  // replaced (a corrected file = a new version, per CLAUDE.md).
  @Prop({ required: true })
  fileKey!: string;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  fileContentType!: string;

  @Prop({ type: Number, required: true })
  fileSize!: number;

  @Prop({ type: Date, default: null })
  effectiveDate!: Date | null;

  @Prop({ type: String, required: true })
  createdByUserId!: string;
}

export const DocumentVersionSchema = SchemaFactory.createForClass(DocumentVersion);

// Iron Rule 5 + DOC-2: version numbers are unique per document.
DocumentVersionSchema.index(
  { tenantId: 1, documentId: 1, majorVersion: 1, minorVersion: 1 },
  { unique: true },
);
DocumentVersionSchema.index({ tenantId: 1, documentId: 1, state: 1 });
