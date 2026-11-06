import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadConfig, loadDatabaseConfig } from '../../src/config/config';
import { parseDatabaseUrl } from '../../src/db/pg-url';
import { isSupabaseHost, SUPABASE_CA_SHA256, supabaseCaPath } from '../../src/db/supabase-ca';

// Fake values only (never real credentials). The password text lets us check it never appears in error messages.
const FAKE_PW = 'Zq9-fake-pw-for-tests';
const remoteUrl = `postgresql://app_user:${FAKE_PW}@db.invalid.example:5432/postgres`;
const a = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
const b = 'f9e8d7c6b5a40312f9e8d7c6b5a40312f9e8d7c6b5a40312f9e8d7c6b5a40312';
const prod = (o: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production', DATABASE_URL: remoteUrl, HANQ_JWT_ISSUER: 'https://api.hanq.invalid', HANQ_JWT_ACCESS_SECRET: a, HANQ_JWT_REFRESH_SECRET: b,
  HANQ_CORS_ORIGINS: 'https://hanq.invalid', HANQ_COOKIE_SAMESITE: 'lax', ...o,
});

function throwsClean(fn: () => unknown, re: RegExp) {
  assert.throws(fn, (e: Error) => {
    assert.match(e.message, re);
    assert.ok(!e.message.includes(FAKE_PW) && !e.message.includes('db.invalid.example'), 'error message must not leak the URL');
    return true;
  });
}

describe('config fails closed', () => {
  it('uses the current public frontend by default without an asset ENV', () => {
    const c = loadConfig(prod());
    assert.equal(c.cbt?.assetDir, null);
    assert.equal(c.cbt?.publicAssetBaseUrl, 'https://study.fileisland.co.kr/media/cbt-originals');
    assert.equal(loadConfig(prod({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: '' })).cbt?.publicAssetBaseUrl, c.cbt?.publicAssetBaseUrl);
    assert.equal(loadConfig(prod({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: '  ' })).cbt?.publicAssetBaseUrl, c.cbt?.publicAssetBaseUrl);
    assert.equal(loadConfig(prod({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: 'https://assets.example.invalid/cbt/' })).cbt?.publicAssetBaseUrl, 'https://assets.example.invalid/cbt');
    assert.equal(loadConfig(prod({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: 'off' })).cbt?.publicAssetBaseUrl, null);
    for (const bad of ['http://evil.example/images', 'https://u:p@evil.example/images', 'https://evil.example/images?token=x']) {
      const invalid = loadConfig(prod({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: bad }));
      assert.equal(invalid.cbt?.publicAssetBaseUrl, null);
      assert.ok(invalid.warnings.some(x => x.includes('HANQ_CBT_PUBLIC_ASSET_BASE_URL')));
    }
  });
  it('accepts a complete production config with verified TLS', () => {
    const c = loadConfig(prod());
    assert.equal(c.env, 'production');
    assert.deepEqual(c.database.ssl, { rejectUnauthorized: true });
    assert.equal(c.cookie.secure, true);
    assert.equal(c.payment.provider, 'none');
    assert.equal(c.premium.priceKRW, 5000);
    assert.equal(c.premium.period, 'calendar-month');
  });
  for (const key of ['DATABASE_URL', 'HANQ_JWT_ISSUER', 'HANQ_JWT_ACCESS_SECRET', 'HANQ_JWT_REFRESH_SECRET', 'HANQ_CORS_ORIGINS', 'HANQ_COOKIE_SAMESITE']) {
    it(`production requires ${key}`, () => throwsClean(() => loadConfig(prod({ [key]: undefined })), new RegExp(key)));
  }
  it('rejects weak, placeholder or identical JWT secrets', () => {
    throwsClean(() => loadConfig(prod({ HANQ_JWT_ACCESS_SECRET: 'short' })), /at least 32/);
    throwsClean(() => loadConfig(prod({ HANQ_JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' })), /placeholder/);
    throwsClean(() => loadConfig(prod({ HANQ_JWT_REFRESH_SECRET: a })), /must differ/);
  });
  it('rejects disabling TLS for a remote database and in production', () => {
    throwsClean(() => loadConfig(prod({ HANQ_DB_SSL_MODE: 'disable' })), /loopback/);
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: remoteUrl, HANQ_DB_SSL_MODE: 'disable' }), /loopback/);
  });
  it('ignores sslmode in the URL (cannot weaken verification)', () => {
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: remoteUrl + '?sslmode=disable' });
    assert.deepEqual(c.database.ssl, { rejectUnauthorized: true });
  });
  it('uses a provided CA file and rejects non-PEM content', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: remoteUrl, HANQ_DB_CA_FILE: '/ca.pem' }, { readFile: () => pem });
    assert.deepEqual(c.database.ssl, { rejectUnauthorized: true, ca: pem });
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: remoteUrl, HANQ_DB_CA_FILE: '/x' }, { readFile: () => 'nope' }), /PEM/);
  });
  it('supports a session-pooler style URL on port 5432 with an encoded password', () => {
    const p = parseDatabaseUrl('postgresql://postgres.abcdefghijkl:p%40ss%2Fword@aws-0-region.pooler.invalid:5432/postgres');
    assert.deepEqual(p, { host: 'aws-0-region.pooler.invalid', port: 5432, user: 'postgres.abcdefghijkl', password: 'p@ss/word', database: 'postgres' });
  });
  it('accepts the JDBC form with credentials in the query (fictional values), decoded like pgjdbc', () => {
    const p = parseDatabaseUrl('jdbc:postgresql://aws-0-xx.pooler.invalid:5432/postgres?user=postgres.abc&password=p%40ss%26w%2Bd+x&sslmode=disable');
    assert.deepEqual(p, { host: 'aws-0-xx.pooler.invalid', port: 5432, user: 'postgres.abc', password: 'p@ss&w+d x', database: 'postgres' });
    const q = parseDatabaseUrl('JDBC:postgresql://h.invalid/db?password=only-pw&user=u');
    assert.equal(q.user, 'u');
    assert.equal(q.port, 5432);
    // userinfo and an identical query field agree → fine
    assert.equal(parseDatabaseUrl('jdbc:postgresql://u:pw@h.invalid/db?user=u').password, 'pw');
  });
  it('JDBC ambiguity fails closed without echoing values', () => {
    const secretPw = 'Zz9-never-echo';
    throwsClean(() => parseDatabaseUrl(`jdbc:postgresql://h.invalid/db?user=a&user=b&password=${secretPw}`), /repeats the user field/);
    throwsClean(() => parseDatabaseUrl(`jdbc:postgresql://h.invalid/db?user=a&password=${secretPw}&password=x`), /repeats the password field/);
    throwsClean(() => parseDatabaseUrl(`jdbc:postgresql://a:${secretPw}@h.invalid/db?user=b`), /two different user/);
    throwsClean(() => parseDatabaseUrl(`jdbc:postgresql://a:${secretPw}@h.invalid/db?password=other`), /two different password/);
    throwsClean(() => parseDatabaseUrl(`jdbc:postgresql://h1.invalid,h2.invalid/db?user=a&password=${secretPw}`), /(exactly one host|not a valid URL)/);
    throwsClean(() => parseDatabaseUrl(`jdbc:mysql://h.invalid/db?user=a&password=${secretPw}`), /must start with/);
    for (const bad of [`jdbc:postgresql://h.invalid/db?password=${secretPw}`]) {
      assert.throws(() => parseDatabaseUrl(bad), (e: Error) => /no user/.test(e.message) && !e.message.includes(secretPw));
    }
  });
  it('a JDBC DATABASE_URL works through loadDatabaseConfig and TLS query overrides are ignored', () => {
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: `jdbc:postgresql://db.invalid.example:5432/postgres?user=app&password=${FAKE_PW}&sslmode=disable&ssl=false` });
    assert.deepEqual(c.database.ssl, { rejectUnauthorized: true });
    assert.equal(c.database.password, FAKE_PW);
  });
  it('Supabase hosts use the pinned project CA by default; a wrong or missing file fails closed', () => {
    const sb = 'jdbc:postgresql://aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?user=postgres.fakeref&password=' + FAKE_PW;
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: sb }, { readFile: () => { throw new Error('ENOENT'); } }), /ca:supabase/);
    const otherPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: sb }, { readFile: () => otherPem }), /pinned Supabase CA fingerprint/);
    // an explicit CA always wins (no pin check: the operator chose it)
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: sb, HANQ_DB_CA_FILE: '/ops/ca.pem' }, { readFile: () => otherPem });
    assert.deepEqual(c.database.ssl, { rejectUnauthorized: true, ca: otherPem });
    assert.equal(isSupabaseHost('db.abcdefghij.supabase.co'), true);
    assert.equal(isSupabaseHost('evil-supabase.com.example'), false);
    assert.equal(isSupabaseHost('notsupabase.com'), false);
  });
  it('the bundled certs/supabase-prod-ca-2021.crt matches the pin (when present)', { skip: !existsSync(supabaseCaPath()) }, () => {
    const sb = 'jdbc:postgresql://aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?user=postgres.fakeref&password=x';
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: sb });
    const ssl = c.database.ssl as { rejectUnauthorized: true; ca?: string };
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca ?? '', /BEGIN CERTIFICATE/);
    assert.equal(new X509Certificate(ssl.ca ?? '').fingerprint256.toUpperCase(), SUPABASE_CA_SHA256);
  });
  it('JWT secrets: legacy JWT_* names are used only when HANQ_JWT_* are empty; conflicts fail without values', () => {
    const legacy = loadConfig(prod({ HANQ_JWT_ACCESS_SECRET: undefined, HANQ_JWT_REFRESH_SECRET: '', JWT_ACCESS_SECRET: a, JWT_REFRESH_SECRET: b }));
    assert.deepEqual(Buffer.from(legacy.jwt.accessSecret).toString(), a);
    assert.ok(legacy.warnings.some((w) => /JWT_ACCESS_SECRET is deprecated/.test(w) && !w.includes(a)));
    const same = loadConfig(prod({ JWT_ACCESS_SECRET: a })); // identical duplicate is fine
    assert.equal(Buffer.from(same.jwt.accessSecret).toString(), a);
    assert.throws(() => loadConfig(prod({ JWT_ACCESS_SECRET: b })), (e: Error) => /both set to different values/.test(e.message) && !e.message.includes(a) && !e.message.includes(b));
    throwsClean(() => loadConfig(prod({ HANQ_JWT_ACCESS_SECRET: undefined, JWT_ACCESS_SECRET: b })), /must differ/);
  });
  it('database-only config (migrate/seed) does not need JWT settings', () => {
    const c = loadDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: remoteUrl });
    assert.equal(c.database.host, 'db.invalid.example');
  });
  it('blocks the test payment provider in production', () => {
    throwsClean(() => loadConfig(prod({ HANQ_PAYMENT_PROVIDER: 'test' })), /blocked in production/);
  });
  it('forces Secure cookies in production and for SameSite=None', () => {
    throwsClean(() => loadConfig(prod({ HANQ_COOKIE_SECURE: 'false' })), /must be true/);
    throwsClean(() => loadConfig({ ...prod(), NODE_ENV: 'development', HANQ_COOKIE_SAMESITE: 'none', HANQ_COOKIE_SECURE: 'false', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/x' }), /requires/);
  });
  it('production CORS origins must be exact https origins', () => {
    throwsClean(() => loadConfig(prod({ HANQ_CORS_ORIGINS: 'http://hanq.invalid' })), /https/);
    throwsClean(() => loadConfig(prod({ HANQ_CORS_ORIGINS: 'https://hanq.invalid/' })), /exact origins/);
    throwsClean(() => loadConfig(prod({ HANQ_CORS_ORIGINS: '*' })), /invalid origin/);
  });
  it('tests only accept a loopback *_test database and never read DATABASE_URL', () => {
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://hanq_test@127.0.0.1:55439/hanq_test' }), /HANQ_TEST_DATABASE_URL/);
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: remoteUrl }), /loopback/);
    throwsClean(() => loadDatabaseConfig({ NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1:55439/postgres' }), /_test/);
    const ok = loadDatabaseConfig({ NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: 'postgresql://hanq_test:x@127.0.0.1:55439/hanq_test' });
    assert.equal(ok.database.port, 55439);
    assert.equal(ok.database.ssl, false);
  });
});

