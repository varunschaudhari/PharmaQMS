import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';
import { NumberingCounter, NumberingCounterSchema } from './schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from './schemas/numbering-scheme.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NumberingScheme.name, schema: NumberingSchemeSchema },
      { name: NumberingCounter.name, schema: NumberingCounterSchema },
    ]),
  ],
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
