import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  // rawBody: true exposes request.rawBody — needed by the PLT-6-WA WhatsApp webhook to verify
  // Meta's X-Hub-Signature-256 header (HMAC over the exact bytes received, not the re-serialized
  // parsed JSON).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

void bootstrap();
