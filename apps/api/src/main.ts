import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // CORS — Phase 0 dev : autorise localhost:3000 (Next.js).
  // Phase 1 : whitelist par tenant (custom domain → tenant) à concevoir.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dev-Tenant-Id', 'X-Dev-User-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  app.get(PinoLogger).log(`Matix API démarré sur http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
