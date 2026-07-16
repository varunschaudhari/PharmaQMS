import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../../platform/audit/audit.module';
import { EsignModule } from '../../platform/esign/esign.module';
import { NumberingModule } from '../../platform/numbering/numbering.module';
import { QrModule } from '../../platform/qr/qr.module';
import { MaterialLotController } from './material-lot.controller';
import { MaterialLotService } from './material-lot.service';
import { MaterialLot, MaterialLotSchema } from './schemas/material-lot.schema';

// QRX-2 module (SPEC.md §7.4) — depends only on platform services, same shape as RoomsModule.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: MaterialLot.name, schema: MaterialLotSchema }]),
    NumberingModule,
    QrModule,
    AuditModule,
    EsignModule,
  ],
  controllers: [MaterialLotController],
  providers: [MaterialLotService],
  exports: [MaterialLotService],
})
export class MaterialsModule {}
