import { Module } from '@nestjs/common';
import { PdfRenderService } from './pdf-render.service';

@Module({
  providers: [PdfRenderService],
  exports: [PdfRenderService],
})
export class PdfModule {}
