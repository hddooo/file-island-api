import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, readdir } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
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
import { OpeningStructureService } from '../../src/textbook/opening-structure.service';
import { OpeningScriptController } from '../../src/textbook/opening-script.controller';
import { ScriptHeadersGuard } from '../../src/textbook/joseon-script.controller';
import { OPENING_SCRIPT_IDENTITY, OPENING_SCRIPT_ROOT, OpeningScriptService, type ScriptPin } from '../../src/textbook/opening-script.service';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';
import { TextbookModule } from '../../src/textbook/textbook.module';
import { SourceBlankProgressService } from '../../src/textbook/source-blank-progress';
import { JOSEON_SCRIPT_IDENTITY, JOSEON_SCRIPT_ROOT } from '../../src/textbook/joseon-script.service';
import { GORYEO_SCRIPT_IDENTITY, GORYEO_SCRIPT_ROOT } from '../../src/textbook/goryeo-script.service';
import { HealthController } from '../../src/health/health.controller';
import { AuthController } from '../../src/auth/auth.controller';
import { DbService } from '../../src/db/db.service';
import { APP_CONFIG } from '../../src/common/tokens';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const inventoryFigure = (f: ScriptPin['figures'][number]) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256, width: f.width, height: f.height });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hanq-script-'));
  const source = Buffer.from('synthetic source only');
  const sourceSha256 = sha(source), prefix = `history/opening/81-2026/${sourceSha256.slice(0, 12)}/`;
  const figures = Array.from({ length: 15 }, (_, i) => {
    const name = `p060-${String(i + 1).padStart(2, '0')}.png`;
    return { name, bytes: png.length, sha256: sha(png), width: 1, height: 1, assetKey: prefix + name };
  });
  const projectionSha256 = sha(Buffer.from('synthetic projection'));
  const bundle = Buffer.from(JSON.stringify({ schema: 'hanq-opening-local/1', source: { sha256: sourceSha256, bytes: source.length },
    projectionSha256, inventory: [...figures.map(inventoryFigure), { name: 'scirpt.md', bytes: source.length, sha256: sourceSha256 }],
    topics: [{ id: 'heungseon', title: 'synthetic', from: 89, to: 90 }, { id: 'opening-policy', title: 'synthetic', from: 91, to: 95 },
      { id: 'sovereignty', title: 'synthetic', from: 96, to: 104 }, { id: 'culture', title: 'synthetic', from: 105, to: 107 }],
    counts: { questions: 118, answers: 118, fields: 119, candidates: 41, orderQuestions: 4 }, markdown: source.toString() }));
  const pin: ScriptPin = { schema: 'hanq-opening-script-pin/1', sourceSha256, sourceBytes: source.length, prefix, projectionSha256,
    bundle: { bytes: bundle.length, sha256: sha(bundle) }, figures };
  await writeFile(join(root, 'scirpt.md'), source); await writeFile(join(root, 'bundle.json'), bundle);
  for (const f of figures) await writeFile(join(root, f.name), png);
  let revoked = false;
  const now = new Date(), userId = randomUUID(), sessionId = randomUUID();
  const config = loadConfig({ NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: 'postgresql://unused@127.0.0.1/unused_test',
    HANQ_JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), HANQ_JWT_REFRESH_SECRET: randomBytes(32).toString('hex') });
  const tokens = new TokenService(config), { token } = await tokens.signAccess(userId, sessionId, now);
  const auth: AuthService = Object.assign(Object.create(AuthService.prototype), { tokens, clock: { now: () => now },
    sessions: new SessionsRepository(), db: { pool: { query: async (sql: string, values: unknown[]) => {
      assert.match(sql, /^SELECT 1 FROM hanq.session_families/);
      assert.deepEqual(values, [sessionId, userId, now]);
      return { rowCount: revoked ? 0 : 1 };
    } } } });
  const module = await Test.createTestingModule({ controllers: [OpeningScriptController], providers: [OpeningScriptService,
    {provide:OpeningStructureService,useValue:{get:async()=>Buffer.from('{}')}},
    ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard, { provide: OPENING_SCRIPT_ROOT, useValue: root },
    { provide: OPENING_SCRIPT_IDENTITY, useValue: pin },
    { provide: AuthService, useValue: auth },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new ApiExceptionFilter()); await app.init();
  const request = supertest(app.getHttpServer()), base = `/api/v1/textbook/scripts/opening/${sourceSha256}`;
  return { root, pin, bundle, source, app, request, base, token, auth, config, service: module.get(OpeningScriptService), revoke: () => { revoked = true; },
    get: (route: string) => request.get(base + route).set('Authorization', `Bearer ${token}`),
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('GET byte delivery, private headers, JWT/live-session denial and no writes/static routes', async () => {
  const f = await fixture();
  try {
    const before = await readdir(f.root);
    for (const path of ['/bundle', '/structure', '/figures/p060-01.png']) {
      await f.request.get(f.base + path).expect(401).expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff').expect('Cross-Origin-Resource-Policy', 'same-site');
      await f.request.get(f.base + path).set('Authorization', 'Bearer invalid-session-token-123456').expect(401);
      await f.get(path).expect(200).expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff').expect('Cross-Origin-Resource-Policy', 'same-site');
      await f.request.post(f.base + path).set('Authorization', `Bearer ${f.token}`).expect(404);
      await f.request.put(f.base + path).set('Authorization', `Bearer ${f.token}`).expect(404);
    }
    const json = await f.get('/bundle').expect('Content-Type', /application\/json/);
    assert.equal(sha(Buffer.from(json.text)), f.pin.bundle.sha256);
    const image = await f.get('/figures/p060-01.png').expect('Content-Type', /image\/png/);
    assert.deepEqual(image.body, png);
    await f.request.get('/history/opening/81-2026/p060-01.png').expect(404);
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

for (const mode of ['missing', 'bundle-hash', 'source-hash', 'png-hash', 'png-signature', 'png-size', 'schema', 'duplicate', 'symlink', 'dimensions', 'dimension-limit', 'html', 'bundle-size', 'source-size', 'markdown', 'projection', 'counts', 'topics', 'inventory'] as const) {
  test(`partial or invalid edition fails closed: ${mode}`, async (t) => {
    const f = await fixture();
    try {
      if (mode === 'missing') await rm(join(f.root, 'p060-15.png'));
      if (mode === 'bundle-hash') await writeFile(join(f.root, 'bundle.json'), Buffer.from(f.bundle.toString().replace('synthetic source', 'synthetic sourcX')));
      if (mode === 'source-hash') await writeFile(join(f.root, 'scirpt.md'), Buffer.alloc(f.source.length));
      if (mode === 'png-hash') await writeFile(join(f.root, 'p060-01.png'), Buffer.alloc(png.length));
      if (mode === 'png-size') f.pin.figures[0].bytes = 2_000_001;
      if (mode === 'bundle-size') f.pin.bundle.bytes = 512_001;
      if (mode === 'source-size') f.pin.sourceBytes = 256_001;
      if (mode === 'duplicate') f.pin.figures[1].name = f.pin.figures[0].name;
      if (['markdown', 'projection', 'counts', 'topics', 'inventory'].includes(mode)) {
        const b = JSON.parse(f.bundle.toString());
        if (mode === 'markdown') b.markdown += 'tampered';
        if (mode === 'projection') b.projectionSha256 = '0'.repeat(64);
        if (mode === 'counts') b.counts.fields = 118;
        if (mode === 'topics') b.topics[3].to = 106;
        if (mode === 'inventory') b.inventory.pop();
        const bytes = Buffer.from(JSON.stringify(b)); f.pin.bundle = { bytes: bytes.length, sha256: sha(bytes) };
        await writeFile(join(f.root, 'bundle.json'), bytes);
      }
      if (['schema', 'png-signature', 'png-size', 'dimensions', 'dimension-limit', 'html'].includes(mode)) {
        const b = JSON.parse(f.bundle.toString());
        if (mode === 'schema') b.schema = 'unknown';
        else if (mode === 'png-size') b.inventory[0].bytes = f.pin.figures[0].bytes;
        else if (mode === 'dimensions' || mode === 'dimension-limit') {
          f.pin.figures[0].width = mode === 'dimensions' ? 2 : 10001;
          b.inventory[0].width = f.pin.figures[0].width;
        } else {
          const bad = mode === 'html' ? Buffer.from('<html>login page must never be an image</html>') : Buffer.alloc(png.length);
          await writeFile(join(f.root, 'p060-01.png'), bad);
          f.pin.figures[0].sha256 = sha(bad); f.pin.figures[0].bytes = bad.length;
          b.inventory[0] = inventoryFigure(f.pin.figures[0]);
        }
        const bytes = Buffer.from(JSON.stringify(b)); f.pin.bundle = { bytes: bytes.length, sha256: sha(bytes) };
        await writeFile(join(f.root, 'bundle.json'), bytes);
      }
      if (mode === 'symlink') {
        await rm(join(f.root, 'p060-01.png'));
        try { await symlink(join(f.root, 'p060-02.png'), join(f.root, 'p060-01.png')); }
        catch (error) {
          if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
            t.skip('Windows file symlink privilege unavailable; ancestor junction covered separately'); return;
          }
          throw error;
        }
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

test('ancestor directory symlink/junction cannot select an edition', async () => {
  const f = await fixture();
  const alias = f.root + '-alias';
  try {
    await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const service = new OpeningScriptService(alias, f.pin);
    await assert.rejects(service.bundle(f.pin.sourceSha256), { code: 'script_unavailable' });
  } finally { await rm(alias, { force: true }); await f.close(); }
});

test('cancellation never poisons shared verification or writes data', async () => {
  const f = await fixture();
  try {
    const before = await Promise.all((await readdir(f.root)).map(async name => [name, sha(await readFile(join(f.root, name)))]));
    const early = AbortSignal.abort();
    await assert.rejects(f.service.bundle(f.pin.sourceSha256, early), { name: 'AbortError' });
    await assert.rejects(f.service.figure(f.pin.sourceSha256, 'p060-01.png', early), { name: 'AbortError' });
    const abort = new AbortController();
    const cancelled = f.service.bundle(f.pin.sourceSha256, abort.signal);
    abort.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.deepEqual(await f.service.bundle(f.pin.sourceSha256), f.bundle);
    assert.deepEqual(await f.service.figure(f.pin.sourceSha256, 'p060-01.png'), png);
    const after = await Promise.all((await readdir(f.root)).map(async name => [name, sha(await readFile(join(f.root, name)))]));
    assert.deepEqual(after, before);
  } finally { await f.close(); }
});

test('closed HTTP response cancels delivery and suppresses response writes', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let signal: AbortSignal | undefined;
  const service = { bundle: async (_source: string, s: AbortSignal) => {
    signal = s; await pending; s.throwIfAborted(); return png;
  } } as OpeningScriptService;
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    type: () => { throw new Error('response must not be written'); },
  });
  const result = new OpeningScriptController(service,{} as OpeningStructureService).bundle('synthetic', response as unknown as Response);
  response.destroyed = true; response.emit('close'); release();
  await result;
  assert.equal(signal?.aborted, true);
  assert.equal(response.listenerCount('close'), 0);
});

for (const mode of ['absent', 'partial', 'corrupt'] as const) {
  test(`optional Opening ${mode} data does not block startup, health, auth, Joseon or Goryeo`, async () => {
    const f = await fixture();
    // Independent valid synthetic Joseon edition. Never use real accounts or production data.
    const joseonRoot = join(f.root, 'joseon');
    await mkdir(joseonRoot);
    const source = Buffer.from('independent synthetic Joseon');
    const sourceSha256 = sha(source), prefix = `history/joseon/81-2026/${sourceSha256.slice(0, 12)}/`;
    const figures = Array.from({ length: 38 }, (_, i) => {
      const name = `p060-${String(i + 1).padStart(2, '0')}.png`;
      return { name, bytes: png.length, sha256: sha(png), width: 1, height: 1, assetKey: prefix + name };
    });
    const bundle = Buffer.from(JSON.stringify({ schema: 'hanq-joseon-script/1', source: {
      sha256: sourceSha256, bytes: source.length, assetKeyPrefix: prefix, access: 'authenticated-private-only',
      canonicalQuizMapping: 'not-established', questions: 172, pages: Array.from({ length: 29 }, (_, i) => i + 59),
    }, topics: [{}, {}, {}, {}], figures: figures.map(item => item.name), figureManifest: figures,
    segments: Array.from({ length: 45 }, (_, i) => ({ id: `synthetic-${i}`, kind: 'study', markdown: 'synthetic' })) }));
    const pin = { schema: 'hanq-joseon-script-pin/1', sourceSha256, sourceBytes: source.length, prefix,
      bundle: { bytes: bundle.length, sha256: sha(bundle) }, figures };
    await writeFile(join(joseonRoot, 'scirpt.md'), source); await writeFile(join(joseonRoot, 'bundle.json'), bundle);
    for (const figure of figures) await writeFile(join(joseonRoot, figure.name), png);
    const goryeoRoot = join(f.root, 'goryeo'); await mkdir(goryeoRoot);
    const gp = `history/goryeo/81-2026/${sourceSha256.slice(0, 12)}/`;
    const gf = figures.slice(0, 24).map(figure => ({ ...figure, assetKey: gp + figure.name }));
    const gb = Buffer.from(JSON.stringify({ schema: 'hanq-goryeo-script/1', source: {
      sha256: sourceSha256, bytes: source.length, assetKeyPrefix: gp, access: 'authenticated-private-only',
      canonicalQuizMapping: 'not-established', questions: 100, responseItems: 103, printedAnswers: 100,
      pages: Array.from({ length: 18 }, (_, i) => i + 41),
    }, topics: [{}, {}, {}], figures: gf.map(figure => figure.name), figureManifest: gf,
    segments: Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-${i}`, kind: 'study', markdown: 'synthetic' })) }));
    const gpin = { schema: 'hanq-goryeo-script-pin/1', sourceSha256, sourceBytes: source.length, prefix: gp,
      bundle: { bytes: gb.length, sha256: sha(gb) }, figures: gf };
    await writeFile(join(goryeoRoot, 'scirpt.md'), source); await writeFile(join(goryeoRoot, 'bundle.json'), gb);
    for (const figure of gf) await writeFile(join(goryeoRoot, figure.name), png);
    if (mode === 'partial') await rm(join(f.root, 'p060-15.png'));
    if (mode === 'corrupt') await writeFile(join(f.root, 'bundle.json'), Buffer.alloc(f.bundle.length));
    // Use the real TextbookModule registration lists; dependencies are isolated, never an operating DB.
    const module = await Test.createTestingModule({
      controllers: [...Reflect.getMetadata('controllers', TextbookModule), HealthController, AuthController],
      providers: [...Reflect.getMetadata('providers', TextbookModule), JwtAuthGuard,
        { provide: APP_CONFIG, useValue: f.config }, { provide: AuthService, useValue: f.auth },
        { provide: DbService, useValue: { ping: async () => true } },
        { provide: OPENING_SCRIPT_ROOT, useValue: mode === 'absent' ? join(f.root, 'absent') : f.root },
        { provide: OPENING_SCRIPT_IDENTITY, useValue: f.pin },
        { provide: JOSEON_SCRIPT_ROOT, useValue: joseonRoot }, { provide: JOSEON_SCRIPT_IDENTITY, useValue: pin },
        { provide: GORYEO_SCRIPT_ROOT, useValue: goryeoRoot }, { provide: GORYEO_SCRIPT_IDENTITY, useValue: gpin },
      ],
    }).overrideProvider(SourceBlankProgressService).useValue({}).compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    try {
      await app.init(); // Must succeed before any edition reads.
      const request = supertest(app.getHttpServer());
      const verifyUnaffected = async () => {
        await request.get('/api/v1/health').expect(200, { status: 'ok' });
        // Local guard denial only: no auth mutation method is called.
        await request.post('/api/v1/auth/logout-all').expect(401);
        const base = `/api/v1/textbook/scripts/joseon/${sourceSha256}`;
        const json = await request.get(base + '/bundle').set('Authorization', `Bearer ${f.token}`).expect(200);
        assert.equal(sha(Buffer.from(json.text)), pin.bundle.sha256);
        const image = await request.get(base + '/figures/p060-01.png').set('Authorization', `Bearer ${f.token}`).expect(200);
        assert.deepEqual(image.body, png);
        const gbase = `/api/v1/textbook/scripts/goryeo/${sourceSha256}`;
        const gjson = await request.get(gbase + '/bundle').set('Authorization', `Bearer ${f.token}`).expect(200);
        assert.equal(sha(Buffer.from(gjson.text)), gpin.bundle.sha256);
        const gimage = await request.get(gbase + '/figures/p060-01.png').set('Authorization', `Bearer ${f.token}`).expect(200);
        assert.deepEqual(gimage.body, png);
      };
      await verifyUnaffected();
      for (const route of ['/bundle', '/figures/p060-01.png']) {
        await request.get(f.base + route).set('Authorization', `Bearer ${f.token}`).expect(503).expect('Cache-Control', 'private, no-store');
      }
      await verifyUnaffected();
    } finally { await app.close(); await f.close(); }
  });
}
