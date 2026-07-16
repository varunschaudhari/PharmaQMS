import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MaterialLotStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MaterialLotDocument = HydratedDocument<MaterialLot>;

// QRX-2: material lot status-verification record (SPEC.md §7.4, Non-Goals §3 — no quantity/UOM
// field anywhere on this schema; that would be inventory). Regulated entity: no hard delete (Iron
// Rule 3); Approved/Rejected are terminal statuses, not deleted records.
@Schema({ collection: 'materialLots', timestamps: true })
export class MaterialLot {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // PLT-5: e.g. LOT-001 — assigned by the numbering service at creation, never inline.
  @Prop({ required: true, trim: true })
  lotCode!: string;

  @Prop({ required: true, trim: true })
  materialName!: string;

  @Prop({ type: String, default: null, trim: true })
  manufacturer!: string | null;

  @Prop({ type: Date, required: true })
  receivedDate!: Date;

  @Prop({ type: String, enum: Object.values(MaterialLotStatus), required: true, default: MaterialLotStatus.QUARANTINE })
  status!: MaterialLotStatus;
}

export const MaterialLotSchema = SchemaFactory.createForClass(MaterialLot);

// Iron Rule 5: every compound index starts with tenantId.
MaterialLotSchema.index({ tenantId: 1, lotCode: 1 }, { unique: true });
MaterialLotSchema.index({ tenantId: 1, status: 1 });
