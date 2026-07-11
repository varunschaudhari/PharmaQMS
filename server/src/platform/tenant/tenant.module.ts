import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from '../auth/schemas/role.schema';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { DepartmentController } from './department.controller';
import { DepartmentService } from './department.service';
import { Department, DepartmentSchema } from './schemas/department.schema';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: Department.name, schema: DepartmentSchema },
      // User/Role are re-registered here (not imported from AuthModule) to keep platform
      // modules independent of one another; Mongoose dedupes model registration per connection.
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [TenantController, DepartmentController, UserAdminController],
  providers: [TenantService, DepartmentService, UserAdminService],
  exports: [TenantService, DepartmentService, UserAdminService],
})
export class TenantModule {}
