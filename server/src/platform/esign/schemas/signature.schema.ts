import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SignatureMeaning } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { applyAppendOnly } from '../../../common/database/append-only.plugin';

export type SignatureDocument = HydratedDocument<Signature>;

// PLT-3: one immutable e-signature (SPEC.md §5.2 / Iron Rule 4) — a fresh-credential-verified
// signing act, cryptographically bound to the entity content at signing time via snapshotHash.
@Schema({ collection: 'signatures', timestamps: false })
export class Signature {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  userFullName!: string;

  @Prop({ type: String, enum: Object.values(SignatureMeaning), required: true })
  meaning!: SignatureMeaning;

  // Free-form, e.g. 'Document' | 'Equipment' — a polymorphic reference, same rationale as
  // AuditEvent.entityType (one collection spans many different signed entity types).
  @Prop({ type: String, required: true })
  entityType!: string;

  @Prop({ type: String, required: true })
  entityId!: string;

  // SHA-256 hex digest of the canonicalized entity snapshot at signing time (see
  // snapshot-hash.util.ts). Any later mutation of the signed content without a new version would
  // be detectable as a hash mismatch.
  @Prop({ type: String, required: true })
  snapshotHash!: string;

  @Prop({ type: String, default: null })
  reason!: string | null;

  // Server UTC timestamp only (Iron Rule 6) — never trust client clocks.
  @Prop({ type: Date, required: true, default: () => new Date() })
  signedAt!: Date;
}

export const SignatureSchema = SchemaFactory.createForClass(Signature);

SignatureSchema.index({ tenantId: 1, entityType: 1, entityId: 1, signedAt: -1 });

// Signed content is immutable — changes require a new version, never mutation (SPEC.md §5.2).
applyAppendOnly(SignatureSchema, 'signatures is append-only: update/delete operations are not permitted (Iron Rule 4).');
