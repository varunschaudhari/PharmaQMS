import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ALL_PERMISSION_KEYS, type PermissionKey } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

// PLT-1: tenant-configurable role — a named bundle of permission-matrix keys (SPEC.md §5.3).
@Schema({ collection: 'roles', timestamps: true })
export class Role {
  // See user.schema.ts: use SchemaTypes.ObjectId, not Types.ObjectId, for @Prop's `type:` option.
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [String], enum: ALL_PERMISSION_KEYS, default: [] })
  permissions!: PermissionKey[];
}

export const RoleSchema = SchemaFactory.createForClass(Role);

// Iron Rule 5: every compound index starts with tenantId. Role names are unique per tenant.
RoleSchema.index({ tenantId: 1, name: 1 }, { unique: true });
