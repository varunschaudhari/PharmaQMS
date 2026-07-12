import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ControlledCopyService } from './controlled-copy.service';

// DOC-5: the public-ish version check (SPEC §7.1) — NO login, NO PII. Scanning a printed
// controlled copy answers exactly one question: is this version still current? Opening the
// document itself still requires an authenticated, tenant-scoped session.
@Controller('public')
export class DocCheckController {
  constructor(private readonly controlledCopyService: ControlledCopyService) {}

  @Public()
  @Get('doc-check/:code')
  async check(@Param('code') code: string) {
    const data = await this.controlledCopyService.checkVersionByCode(code);
    return { data };
  }
}
