import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { it } from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { REMEMBER_MAX_MS } from '../../src/auth/retention-policy';
import { AppError } from '../../src/common/app-error';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { loadConfig } from '../../src/config/config';
import { DbService } from '../../src/db/db.service';
import { PaymentsService } from '../../src/payments/payments.service';
import { PremiumService } from '../../src/premium/premium.service';

for (const enabled of [false, true]) {
  it(`public plan reports the configured remember capability (${enabled}) through the real Nest module graph`, async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      HANQ_TEST_DATABASE_URL: 'postgresql://synthetic:unused@127.0.0.1:55439/capability_test',
      HANQ_DB_SSL_MODE: 'disable',
      HANQ_JWT_ISSUER: 'capability-test',
      HANQ_JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      HANQ_JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      HANQ_CORS_ORIGINS: 'https://file-island.duckdns.org',
      HANQ_COOKIE_SECURE: 'true',
      HANQ_COOKIE_SAMESITE: 'lax',
      HANQ_CBT_PUBLIC_ASSET_BASE_URL: 'off',
      HANQ_REMEMBER_ENABLED: String(enabled),
    });
    const policy = {
      enabled: config.jwt.rememberEnabled,
      access: config.jwt.accessTtlSec,
      refresh: config.jwt.refreshTtlSec,
      family: config.jwt.sessionMaxSec,
      cookie: { ...config.cookie },
      origins: [...config.cors.origins],
    };
    let databaseCalls = 0;
    const unexpectedDatabase = async () => {
      databaseCalls++;
      throw new Error('public capability must not access a database');
    };
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot({ config })] })
      .overrideProvider(DbService)
      .useValue({ pool: { query: unexpectedDatabase }, tx: unexpectedDatabase })
      .compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    try {
      await app.init();
      const response = await request(app.getHttpServer()).get('/api/v1/premium/plan');
      assert.equal(response.status, 200);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.deepEqual(response.body, {
        plan: app.get(PremiumService).plan(),
        checkout: app.get(PaymentsService).checkoutInfo(),
        testFreePass: app.get(PremiumService).testFreePassInfo(),
        auth: { rememberMe: { available: enabled, maxDays: REMEMBER_MAX_MS / 86400000 } },
      });
      assert.equal(response.body.auth.rememberMe.maxDays, 90);
      const protectedResponse = await request(app.getHttpServer()).get('/api/v1/premium');
      assert.equal(protectedResponse.status, 401, 'public metadata does not grant private access');
      if (!enabled) {
        await assert.rejects(
          app.get(AuthService).signin({ email: 'isolated@example.invalid', password: 'synthetic-only', rememberMe: true }),
          error => error instanceof AppError && error.code === 'remember_unavailable' && error.getStatus() === 503,
        );
      }
      assert.equal(databaseCalls, 0);
      assert.deepEqual({
        enabled: config.jwt.rememberEnabled,
        access: config.jwt.accessTtlSec,
        refresh: config.jwt.refreshTtlSec,
        family: config.jwt.sessionMaxSec,
        cookie: { ...config.cookie },
        origins: [...config.cors.origins],
      }, policy, 'metadata never changes deadlines, opt-in policy, origins or cookie protections');
    } finally {
      await app.close();
    }
  });
}
