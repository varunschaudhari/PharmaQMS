import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditTrailInterceptor } from '../../common/interceptors/audit-trail.interceptor';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditEvent, AuditEventSchema } from './schemas/audit-event.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: AuditEvent.name, schema: AuditEventSchema }])],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditTrailInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
