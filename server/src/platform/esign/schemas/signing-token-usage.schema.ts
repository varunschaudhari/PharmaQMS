import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SigningTokenUsageDocument = HydratedDocument<SigningTokenUsage>;

// PLT-3: tracks consumed signing-token jtis so SignatureGuard can enforce single-use. The unique
// index on `jti` makes consumption atomic — a replayed token's insert fails with a duplicate-key
// error even under concurrent requests. TTL-indexed: signing tokens live ≤2 minutes, so these
// tracking rows are safe to purge well after that (10 minutes).
@Schema({ collection: 'signingTokenUsages', timestamps: false })
export class SigningTokenUsage {
  @Prop({ type: String, required: true, unique: true })
  jti!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  usedAt!: Date;
}

export const SigningTokenUsageSchema = SchemaFactory.createForClass(SigningTokenUsage);

SigningTokenUsageSchema.index({ usedAt: 1 }, { expireAfterSeconds: 600 });
