import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TestRecordModule } from './demo/test-record/test-record.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { authConfig } from './platform/auth/config/auth.config';
import { AuthModule } from './platform/auth/auth.module';
import { AuditModule } from './platform/audit/audit.module';
import { esignConfig } from './platform/esign/config/esign.config';
import { EsignModule } from './platform/esign/esign.module';
import { notificationsConfig } from './platform/notifications/config/notifications.config';
import { NotificationsModule } from './platform/notifications/notifications.module';
import { NumberingModule } from './platform/numbering/numbering.module';
import { qrConfig } from './platform/qr/config/qr.config';
import { QrModule } from './platform/qr/qr.module';
import { TenantModule } from './platform/tenant/tenant.module';
import { WorkflowModule } from './platform/workflow/workflow.module';
import { TrainingModule } from './modules/training/training.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { RoomsModule } from './modules/rooms/room.module';
import { MaterialsModule } from './modules/materials/material-lot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [authConfig, esignConfig, notificationsConfig, qrConfig],
    }),
    // PLT-4: WorkflowService emits 'workflow.step-changed' on every step change;
    // PLT-6's WorkflowNotificationListener subscribes.
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
    NotificationsModule.forRoot(),
    QrModule,
    // Phase 0 gate demo (SPEC.md §8) — throwaway; remove once DOC/TRN/EQP cover the same
    // integrations.
    TestRecordModule,
    // Phase 1 business modules (gate passed — see validation-pack/docs/phase0-demo.md).
    DocumentsModule,
    TrainingModule,
    EquipmentModule,
    RoomsModule,
    MaterialsModule,
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
