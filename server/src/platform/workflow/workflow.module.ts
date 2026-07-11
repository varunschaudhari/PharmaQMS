import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { EsignModule } from '../esign/esign.module';
import { WorkflowInstance, WorkflowInstanceSchema } from './schemas/workflow-instance.schema';
import { WorkflowTemplate, WorkflowTemplateSchema } from './schemas/workflow-template.schema';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkflowTemplate.name, schema: WorkflowTemplateSchema },
      { name: WorkflowInstance.name, schema: WorkflowInstanceSchema },
      // User is re-registered here (not imported from AuthModule) to keep platform modules
      // independent of one another; Mongoose dedupes model registration per connection.
      { name: User.name, schema: UserSchema },
    ]),
    // PLT-3: approve reuses EsignService.verifyAndConsumeSigningToken/createSignature in-process.
    EsignModule,
    // PLT-2: submit/approve/reject/reassign are all audited via @Audited().
    AuditModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
