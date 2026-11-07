import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import type { Clock } from './common/tokens';
import type { AppConfig } from './config/config';

export const BODY_LIMIT = '256kb';

/** Shared by main.ts and the integration tests, so tests exercise the real HTTP stack (headers, CORS, limits, errors). */
export async function createApp(config: AppConfig, clock?: Clock): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config, clock }), {
    bodyParser: false,
    logger: config.env === 'test' ? ['error'] : ['error', 'warn', 'log'],
  });
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(json({ limit: BODY_LIMIT, strict: true, type: 'application/json' }));
  // Body-parser errors happen before Nest routing: answer them in the same redacted shape.
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (!err) return next();
    const status = err.status === 413 ? 413 : 400;
    res.status(status).json({ error: { code: status === 413 ? 'payload_too_large' : 'invalid_json', message: status === 413 ? 'Request body too large' : 'Malformed JSON body' } });
  });
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, !!origin && config.cors.origins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-HanQ-CSRF', 'X-Cbt-Attempt-Token'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: false, validationError: { target: false, value: false } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
