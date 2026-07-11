import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { Tenant, TenantSchema } from '../tenant/schemas/tenant.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [
    // Registered with no default secret: access vs. refresh secrets are passed per sign/verify
    // call (see AuthService.issueTokens / JwtAuthGuard). Re-exported so JwtAuthGuard — a global
    // guard declared in AppModule — can also inject JwtService.
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      // Tenant is re-registered here (not imported from TenantModule) to avoid a circular
      // module dependency — TenantModule's own user-admin slice needs User/Role from here.
      { name: Tenant.name, schema: TenantSchema },
    ]),
    // PLT-2: login/lockout/password-change events are audited (see AuthService).
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
