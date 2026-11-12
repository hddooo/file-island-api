import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { TokenService } from '../../src/auth/token.service';
import { SessionsRepository } from '../../src/auth/sessions.repository';
import { loadConfig } from '../../src/config/config';
import { JwtAuthGuard } from '../../src/auth/guards';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { JoseonScriptController, ScriptHeadersGuard } from '../../src/textbook/joseon-script.controller';
import { JOSEON_SCRIPT_IDENTITY, JOSEON_SCRIPT_ROOT, JoseonScriptService, type ScriptPin } from '../../src/textbook/joseon-script.service';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hanq-script-'));
  const source = Buffer.from('synthetic source only');
  const sourceSha256 = sha(source), prefix = `history/joseon/81-2026/${sourceSha256.slice(0, 12)}/`;
  const figures = Array.from({ length: 38 }, (_, i) => {
    const name = `p060-${String(i + 1).padStart(2, '0')}.png`;
    return { name, bytes: png.length, sha256: sha(png), width: 1, height: 1, assetKey: prefix + name };
  });
  const bundle = Buffer.from(JSON.stringify({ schema: 'hanq-joseon-script/1', source: { sha256: sourceSha256, bytes: source.length,
    assetKeyPrefix: prefix, access: 'authenticated-private-only', canonicalQuizMapping: 'not-established', questions: 172,
    pages: Array.from({ length: 29 }, (_, i) => i + 59) }, topics: [{}, {}, {}, {}], figures: figures.map(f => f.name),
    segments: Array.from({ length: 45 }, (_, i) => ({ id: `synthetic-${i}`, kind: 'study', markdown: 'synthetic' })), figureManifest: figures }));
  const pin: ScriptPin = { schema: 'hanq-joseon-script-pin/1', sourceSha256, sourceBytes: source.length, prefix,
    bundle: { bytes: bundle.length, sha256: sha(bundle) }, figures };
  await writeFile(join(root, 'scirpt.md'), source); await writeFile(join(root, 'bundle.json'), bundle);
  for (const f of figures) await writeFile(join(root, f.name), png);
  let revoked = false;
  const now = new Date(), userId = randomUUID(), sessionId = randomUUID();
  const config = loadConfig({ NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: 'postgresql://unused@127.0.0.1/unused_test',
    HANQ_JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), HANQ_JWT_REFRESH_SECRET: randomBytes(32).toString('hex') });
  const tokens = new TokenService(config), { token } = await tokens.signAccess(userId, sessionId, now);
  const auth: AuthService = Object.assign(Object.create(AuthService.prototype), { tokens, clock: { now: () => now },
    users: { findById: async (pool: unknown, id: string) => {
      assert(pool && typeof pool === 'object' && 'query' in pool); assert.equal(id, userId);
      return { id: userId, approval_status: 'approved' as const };
    } },
    sessions: new SessionsRepository(), db: { pool: { query: async (sql: string, values: unknown[]) => {
      assert.match(sql, /^SELECT 1 FROM hanq.session_families/);
      assert.deepEqual(values, [sessionId, userId, now]);
      return { rowCount: revoked ? 0 : 1 };
    } } } });
  const module = await Test.createTestingModule({ controllers: [JoseonScriptController], providers: [JoseonScriptService,
    ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard, { provide: JOSEON_SCRIPT_ROOT, useValue: root },
    { provide: JOSEON_SCRIPT_IDENTITY, useValue: pin },
    { provide: AuthService, useValue: auth },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new ApiExceptionFilter()); await app.init();
  const request = supertest(app.getHttpServer()), base = `/api/v1/textbook/scripts/joseon/${sourceSha256}`;
  return { root, pin, bundle, source, app, request, base, token, service: module.get(JoseonScriptService), revoke: () => { revoked = true; },
    get: (route: string) => request.get(base + route).set('Authorization', `Bearer ${token}`),
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('GET byte delivery, private headers, JWT/live-session denial and no writes/static routes', async () => {
  const f = await fixture();
  try {
    const before = await readdir(f.root);
    for (const path of ['/bundle', '/figures/p060-01.png']) {
      await f.request.get(f.base + path).expect(401).expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
      await f.request.get(f.base + path).set('Authorization', 'Bearer invalid-session-token-123456').expect(401);
      await f.get(path).expect(200).expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
      await f.request.post(f.base + path).set('Authorization', `Bearer ${f.token}`).expect(404);
      await f.request.put(f.base + path).set('Authorization', `Bearer ${f.token}`).expect(404);
    }
    const json = await f.get('/bundle').expect('Content-Type', /application\/json/);
    assert.equal(sha(Buffer.from(json.text)), f.pin.bundle.sha256);
    const image = await f.get('/figures/p060-01.png').expect('Content-Type', /image\/png/);
    assert.deepEqual(image.body, png);
    await f.request.get('/history/joseon/81-2026/p060-01.png').expect(404);
    f.revoke(); await f.get('/bundle').expect(401); await f.get('/figures/p060-01.png').expect(401);
    assert.deepEqual(await readdir(f.root), before);
    assert.deepEqual(await readFile(join(f.root, 'bundle.json')), f.bundle);
  } finally { await f.close(); }
});

test('source and filename selection never interprets paths or aliases', async () => {
  const f = await fixture();
  try {
    await f.request.get(f.base.replace(f.pin.sourceSha256, 'a'.repeat(64)) + '/bundle').set('Authorization', `Bearer ${f.token}`).expect(404);
    for (const name of ['p001-01.png', '../bundle.json', '..\\bundle.json', '/etc/passwd', 'p060-01.png%00', 'p060-figure-1', 'bundle.json']) {
      await assert.rejects(f.service.figure(f.pin.sourceSha256, name), { code: 'not_found' });
    }
    await f.get('/figures/..%2Fbundle.json').expect(404);
    await f.get('/figures/..%5Cbundle.json').expect(404);
  } finally { await f.close(); }
});

for (const mode of ['missing', 'bundle-hash', 'source-hash', 'png-hash', 'png-signature', 'png-size', 'schema', 'duplicate', 'symlink'] as const) {
  test(`partial or invalid edition fails closed: ${mode}`, async () => {
    const f = await fixture();
    try {
      if (mode === 'missing') await rm(join(f.root, 'p060-38.png'));
      if (mode === 'bundle-hash') await writeFile(join(f.root, 'bundle.json'), Buffer.from(f.bundle.toString().replace('synthetic-0', 'synthetic-X')));
      if (mode === 'source-hash') await writeFile(join(f.root, 'scirpt.md'), Buffer.alloc(f.source.length));
      if (mode === 'png-hash') await writeFile(join(f.root, 'p060-01.png'), Buffer.alloc(png.length));
      if (mode === 'png-size') f.pin.figures[0].bytes = 2_000_001;
      if (mode === 'duplicate') f.pin.figures[1].name = f.pin.figures[0].name;
      if (mode === 'schema' || mode === 'png-signature') {
        const b = JSON.parse(f.bundle.toString());
        if (mode === 'schema') b.schema = 'unknown';
        else {
          const bad = Buffer.alloc(png.length); await writeFile(join(f.root, 'p060-01.png'), bad);
          f.pin.figures[0].sha256 = sha(bad); b.figureManifest[0].sha256 = sha(bad);
        }
        const bytes = Buffer.from(JSON.stringify(b)); f.pin.bundle = { bytes: bytes.length, sha256: sha(bytes) };
        await writeFile(join(f.root, 'bundle.json'), bytes);
      }
      if (mode === 'symlink') {
        await rm(join(f.root, 'p060-01.png'));
        await symlink(join(f.root, 'p060-02.png'), join(f.root, 'p060-01.png'));
      }
      const result = await f.get('/bundle').expect(503).expect('Content-Type', /application\/json/);
      assert.equal(result.body.error.code, 'script_unavailable');
      await f.get('/figures/p060-03.png').expect(503).expect('Content-Type', /application\/json/);
    } finally { await f.close(); }
  });
}

test('verified immutable bytes cannot be swapped through subsequent disk edits', async () => {
  const f = await fixture();
  try {
    await f.get('/bundle').expect(200);
    await writeFile(join(f.root, 'p060-01.png'), Buffer.from('<html>login</html>'));
    const result = await f.get('/figures/p060-01.png').expect(200).expect('Content-Type', /image\/png/);
    assert.deepEqual(result.body, png);
  } finally { await f.close(); }
});
