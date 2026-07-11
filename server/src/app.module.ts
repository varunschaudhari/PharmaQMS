import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { authConfig } from './platform/auth/config/auth.config';
import { AuthModule } from './platform/auth/auth.module';
import { AuditModule } from './platform/audit/audit.module';
import { esignConfig } from './platform/esign/config/esign.config';
import { EsignModule } from './platform/esign/esign.module';
import { NumberingModule } from './platform/numbering/numbering.module';
import { TenantModule } from './platform/tenant/tenant.module';
import { WorkflowModule } from './platform/workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [authConfig, esignConfig],
    }),
    // PLT-4: WorkflowService emits 'workflow.step-changed' on every step change — no listeners
    // yet (PLT-6 Notifications will subscribe later).
    EventEmitterModule.forRoot(),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/pharmaqms'),
      }),
    }),
    AuthModule,
    AuditModule,
    EsignModule,
    NumberingModule,
    TenantModule,
    WorkflowModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guard order matters: authenticate -> establish tenant context -> check permission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
