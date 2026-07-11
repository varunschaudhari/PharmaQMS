import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { AppService, HealthStatus } from './app.service';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
