import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PdfModule } from '../../common/pdf/pdf.module';
import { AuditModule } from '../audit/audit.module';
import { qrConfig } from './config/qr.config';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { QrCode, QrCodeSchema } from './schemas/qr-code.schema';

@Module({
  imports: [
    ConfigModule.forFeature(qrConfig),
    MongooseModule.forFeature([{ name: QrCode.name, schema: QrCodeSchema }]),
    PdfModule,
    // PLT-2: code minting is audited via @Audited().
    AuditModule,
  ],
  controllers: [QrController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
