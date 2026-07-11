import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { Tenant, TenantSchema } from '../tenant/schemas/tenant.schema';
import { EsignController } from './esign.controller';
import { EsignService } from './esign.service';
import { Signature, SignatureSchema } from './schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from './schemas/signing-token-usage.schema';

@Module({
  imports: [
    // Registered with no default secret, same pattern as AuthModule: the signing-token secret is
    // passed per sign/verify call (see EsignService.challenge / SignatureGuard).
    JwtModule.register({}),
    MongooseModule.forFeature([
      // User/Tenant are re-registered here (not imported from AuthModule/TenantModule) to keep
      // platform modules independent of one another; Mongoose dedupes model registration per
      // connection.
      { name: User.name, schema: UserSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Signature.name, schema: SignatureSchema },
      { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
    ]),
  ],
  controllers: [EsignController],
  providers: [EsignService, SignatureGuard],
  exports: [EsignService, SignatureGuard],
})
export class EsignModule {}
