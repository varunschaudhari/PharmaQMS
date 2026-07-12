import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type QrCodeDocument = HydratedDocument<QrCode>;

// PLT-7: an opaque short code -> entity mapping (SPEC.md §6.1 PLT-7). The code is the lookup
// key for /s/:code scans; it is globally unique (a scan carries no tenant context until the
// code is resolved), but resolution always re-checks the caller's tenant (Iron Rule 5).
@Schema({ collection: 'qrCodes', timestamps: true })
export class QrCode {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // Opaque, collision-safe (unique index + regenerate-and-retry on duplicate). Never derived
  // from entity data — knowing an entity's number must not let anyone forge its scan URL.
  @Prop({ required: true, unique: true })
  code!: string;

  // Polymorphic ref, same pattern as AuditEvent/Signature/WorkflowInstance.
  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ type: String, required: true })
  entityId!: string;

  // Display snapshots printed on the physical label (e.g. 'EQP-0042' / 'pH Meter — QC Lab').
  @Prop({ required: true, trim: true })
  entityCode!: string;

  @Prop({ required: true, trim: true })
  entityName!: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const QrCodeSchema = SchemaFactory.createForClass(QrCode);

// One code per entity per tenant — getOrCreate is idempotent.
QrCodeSchema.index({ tenantId: 1, entityType: 1, entityId: 1 }, { unique: true });
