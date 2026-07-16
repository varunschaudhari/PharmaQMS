import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../../platform/audit/audit.module';
import { DueDateScannerRegistry } from '../../platform/notifications/due-date/due-date-scanner.registry';
import { NumberingModule } from '../../platform/numbering/numbering.module';
import { QrModule } from '../../platform/qr/qr.module';
import { Department, DepartmentSchema } from '../../platform/tenant/schemas/department.schema';
import { RoomCleaningController } from './room-cleaning.controller';
import { RoomCleaningScanner } from './room-cleaning.scanner';
import { RoomCleaningService } from './room-cleaning.service';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomCleaningEntry, RoomCleaningEntrySchema } from './schemas/room-cleaning-entry.schema';
import { RoomCleaningSchedule, RoomCleaningScheduleSchema } from './schemas/room-cleaning-schedule.schema';

// QRX-1 module (SPEC.md §7.4) — depends only on platform services (Department re-registered per
// the established cross-module convention, same as EQP's own module). RoomCleaningService is a
// sub-concern of this SAME module (not a separate top-level business module), so it may depend on
// RoomService directly — see room-cleaning.service.ts's header comment.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: RoomCleaningSchedule.name, schema: RoomCleaningScheduleSchema },
      { name: RoomCleaningEntry.name, schema: RoomCleaningEntrySchema },
    ]),
    NumberingModule,
    QrModule,
    AuditModule,
  ],
  controllers: [RoomController, RoomCleaningController],
  providers: [RoomService, RoomCleaningService, RoomCleaningScanner],
  exports: [RoomService, RoomCleaningService],
})
export class RoomsModule implements OnModuleInit {
  constructor(
    // PLT-6 NotificationsModule is global — injectable without importing the dynamic module.
    private readonly scannerRegistry: DueDateScannerRegistry,
    private readonly cleaningScanner: RoomCleaningScanner,
  ) {}

  // QRX-1: register the cleaning-due scanner into the PLT-6 daily-scan framework.
  onModuleInit(): void {
    this.scannerRegistry.register(this.cleaningScanner);
  }
}
