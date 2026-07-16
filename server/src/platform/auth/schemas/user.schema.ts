import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

// PLT-1: tenant-scoped user account (SPEC.md §5.3). Regulated entity — no hard delete;
// deactivation is via `isActive`, never document removal (Iron Rule 3).
@Schema({ collection: 'users', timestamps: true })
export class User {
  // Use SchemaTypes.ObjectId (not Types.ObjectId) for the `type:` option — it's the SchemaType
  // registry entry @Prop expects; passing the driver-level Types.ObjectId class here silently
  // registers the path as Mixed, and string tenantId queries then never match.
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  // PLT-8: department master assignment — optional (not every user belongs to a department).
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Department', default: null })
  departmentId!: Types.ObjectId | null;

  @Prop({ default: true })
  isActive!: boolean;

  // PLT-8: cross-tenant platform administrator (Varun/support — SPEC.md §4 persona table).
  // Orthogonal to the tenant-scoped permission matrix; only ever set directly in the database or
  // via a future platform-ops tool, never through a tenant-facing endpoint.
  @Prop({ default: false })
  isPlatformAdmin!: boolean;

  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop({ type: Date, default: () => new Date() })
  passwordChangedAt!: Date;

  // Bumped on every refresh-token rotation (and on lockout) to invalidate outstanding refresh tokens.
  @Prop({ default: 0 })
  tokenVersion!: number;

  // PLT-6-WA: E.164 phone number this user has confirmed for WhatsApp delivery; null until set.
  @Prop({ type: String, default: null })
  whatsappPhoneNumber!: string | null;

  // PLT-6-WA: explicit per-user consent — a phone number alone never triggers a send.
  @Prop({ default: false })
  whatsappOptIn!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Iron Rule 5: every compound index starts with tenantId. Email is unique per tenant, not globally.
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
