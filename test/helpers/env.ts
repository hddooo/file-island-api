import { randomBytes } from 'node:crypto';
import { loadConfig, type AppConfig } from '../../src/config/config';

export const ORIGIN = 'http://localhost:5173';

/** Test configuration built ONLY from explicit values. The single thing read from the process environment is
 *  HANQ_TEST_DATABASE_URL, and loadConfig refuses it unless it is a loopback host and a database named *_test.
 *  DATABASE_URL and .env are never read. JWT secrets are random per test process (never persisted). */
const ACCESS = randomBytes(32).toString('hex');
const REFRESH = randomBytes(32).toString('hex');

export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const url = process.env.HANQ_TEST_DATABASE_URL;
  if (!url) throw new Error('HANQ_TEST_DATABASE_URL is required for integration tests (loopback host, database name ending in _test)');
  return {
    NODE_ENV: 'test',
    HANQ_ACCESS_TTL_SECONDS: '600', // Existing integration expiry cases assume ten-minute access tokens.
    HANQ_CBT_PUBLIC_ASSET_BASE_URL: 'off', // tests never fetch operating public assets unless explicitly overridden
    HANQ_TEST_DATABASE_URL: url,
    HANQ_DB_SSL_MODE: 'disable',
    HANQ_JWT_ISSUER: 'hanq-test',
    HANQ_JWT_ACCESS_SECRET: ACCESS,
    HANQ_JWT_REFRESH_SECRET: REFRESH,
    HANQ_CORS_ORIGINS: ORIGIN,
    HANQ_COOKIE_SAMESITE: 'lax',
    HANQ_COOKIE_SECURE: 'false',
    HANQ_PAYMENT_PROVIDER: 'test',
    HANQ_RATE_LIMIT_PER_MINUTE: '100000',
    HANQ_AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    HANQ_LOGIN_FAILURES_PER_15MIN: '1000',
    HANQ_DB_POOL_MAX: '10',
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig(testEnv(overrides));
}

/** Controllable clock shared by the app and the test. */
export class TestClock {
  constructor(public t = Date.parse('2026-10-08T03:00:00.000Z')) {}
  now(): Date {
    return new Date(this.t);
  }
  set(d: Date | string): void {
    this.t = new Date(d).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
