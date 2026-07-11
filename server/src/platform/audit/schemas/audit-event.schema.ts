import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AuditAction, type AuditFieldChange } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { applyAppendOnly } from '../../../common/database/append-only.plugin';

export type AuditEventDocument = HydratedDocument<AuditEvent>;

// PLT-2: one immutable audit event (SPEC.md §5.1). `timestamps: false` — occurredAt is the one
// and only, deliberately-set server timestamp; there is no updatedAt because these documents
// are never updated.
@Schema({ collection: 'auditEvents', timestamps: false })
export class AuditEvent {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // null for the (rare, currently unused) case of a system-initiated event with no human actor.
  @Prop({ type: String, default: null })
  actorId!: string | null;

  @Prop({ type: String, default: null })
  actorName!: string | null;

  // Free-form, e.g. 'User' | 'Document' | 'Equipment' — deliberately not a Mongoose `ref` since
  // one audit collection spans many different entity collections (a polymorphic reference).
  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ type: String, required: true })
  entityId!: string;

  @Prop({ type: String, enum: Object.values(AuditAction), required: true })
  action!: AuditAction;

  @Prop({ type: [Object], default: [] })
  changes!: AuditFieldChange[];

  // Mandatory on changes to approved records per SPEC.md §5.1 — enforcement of *when* it's
  // mandatory belongs to each business module; PLT-2 just stores it when supplied.
  @Prop({ type: String, default: null })
  reason!: string | null;

  // Server UTC timestamp only (Iron Rule 6) — never trust client clocks.
  @Prop({ type: Date, required: true, default: () => new Date() })
  occurredAt!: Date;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

AuditEventSchema.index({ tenantId: 1, entityType: 1, entityId: 1, occurredAt: -1 });

// Iron Rule 2: the model exposes create/find only — enforced at the Mongoose layer (see
// common/database/append-only.plugin.ts), not just by convention.
applyAppendOnly(AuditEventSchema, 'auditEvents is append-only: update/delete operations are not permitted (Iron Rule 2).');
