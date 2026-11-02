import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import supertest from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { JwtAuthGuard } from '../../src/auth/guards';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { APP_CONFIG } from '../../src/common/tokens';
import { loadConfig, type AppConfig } from '../../src/config/config';
import { SourceBlankProgressService } from '../../src/textbook/source-blank-progress';
import { TextbookController } from '../../src/textbook/textbook.controller';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';
import { resolveTextbookDataRoot, SEMANTIC_REPOSITORY_ROOT, TextbookService } from '../../src/textbook/textbook.service';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MEMBER_TOKEN = 'member-session-token-123456';
const OTHER_TOKEN = 'other-session-token-123456';
const base = '/api/v1/textbook';
const routes = ['manifest', 'pages/1', 'pages/1/image', 'pages/1/enhanced'];
const png = Buffer.from('89504e470d0a1a0a', 'hex');

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hanq-textbook-test-'));
  for (const folder of ['pages', 'renders', 'enhanced']) await mkdir(join(dir, folder));
  const manifest = { source: { pageCount: 1, sha256: 'a'.repeat(64), bytes: 100, pdfPath: 'source/original.pdf' }, pages: [{ pdfPage: 1, printedPage: null, width: 100, height: 100, dataPath: 'pages/page-001.json', imagePath: 'renders/page-001.png' }] };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'pages/page-001.json'), JSON.stringify({ pdfPage: 1, printedPage: null, width: 100, height: 100, textBlocks: [], text: 'fixture', imagePath: 'renders/page-001.png', vectorPaths: [{ items: [] }], regions: [{ id: 'r1', bbox: [1, 2, 3, 4] }] }));
  await writeFile(join(dir, 'renders/page-001.png'), png);
  await writeFile(join(dir, 'enhanced/page-001.png'), png);
  const config = { textbook: { dataDir: dir } } as AppConfig;
  const revokedTokens = new Set<string>();
  const module = await Test.createTestingModule({
    controllers: [TextbookController],
    providers: [TextbookService, TextbookMemberGuard, JwtAuthGuard,
      { provide: SourceBlankProgressService, useValue: {get: async (id: string) => ({owner:id}), save: async (id: string) => ({owner:id})} },
      { provide: APP_CONFIG, useValue: config },
      { provide: SEMANTIC_REPOSITORY_ROOT, useValue: dir },
      { provide: AuthService, useValue: { authenticate: async (token: string) => revokedTokens.has(token) ? null : token === MEMBER_TOKEN ? { userId: MEMBER, sessionId: 'member' } : token === OTHER_TOKEN ? { userId: OTHER, sessionId: 'other' } : null } },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use((_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return { dir, manifest, config, app, revokedTokens, request: supertest(app.getHttpServer()), close: async () => { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('every textbook endpoint rejects anonymous and invalid/revoked tokens; allows two different authenticated members', async () => {
  const f = await fixture();
  try {
    for (const route of routes) {
      await f.request.get(`${base}/${route}`).expect(401).expect('Cache-Control', /no-store/);
      await f.request.get(`${base}/${route}`).set('Authorization', 'Bearer revoked-session-token-123456').expect(401);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${OTHER_TOKEN}`).expect(200).expect('Cache-Control', /no-store/);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(200).expect('Cache-Control', /no-store/);
    }
    const result = await f.request.get(`${base}/pages/1`).set('Authorization', `Bearer ${MEMBER_TOKEN}`);
    assert.equal(result.body.imagePath, undefined);
    assert.deepEqual(result.body.vectorPaths, [{ items: [] }]);
    assert.deepEqual(result.body.regions, [{ id: 'r1', bbox: [1, 2, 3, 4] }]);
    const manifest = await f.request.get(`${base}/manifest`).set('Authorization', `Bearer ${MEMBER_TOKEN}`);
    assert.equal(manifest.body.source.pdfPath, undefined);
    assert.equal(manifest.body.pages[0].dataPath, undefined);
    await f.request.get('/renders/page-001.png').expect(404);
    await f.request.get('/enhanced/page-001.png').expect(404);
    await f.request.get(`${base}/original.pdf`).expect(404);
  } finally { await f.close(); }
});

test('missing or invalid data config fails closed on every endpoint', async () => {
  const f = await fixture();
  try {
    for (const config of [{ dataDir: join(f.dir, 'missing') }, { dataDir: 'relative' }, { dataDir: process.cwd() }]) {
      f.config.textbook = config;
      for (const route of routes) await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    }
  } finally { await f.close(); }
});

test('fixed numeric page paths reject traversal and malformed indices; manifest and symlink escapes are refused', async () => {
  const f = await fixture();
  try {
    for (const page of ['0', '-1', '01', '1.0', '10000', '2', '%2e%2e%2fmanifest.json', '1%2fimage', '%00']) {
      await f.request.get(`${base}/pages/${page}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    }
    f.manifest.pages[0].dataPath = '../outside.json';
    await writeFile(join(f.dir, 'manifest.json'), JSON.stringify(f.manifest));
    await f.request.get(`${base}/pages/1`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    f.manifest.pages[0].dataPath = 'pages/page-001.json';
    await writeFile(join(f.dir, 'manifest.json'), JSON.stringify(f.manifest));
    await rm(join(f.dir, 'pages/page-001.json'));
    await symlink(join(f.dir, 'manifest.json'), join(f.dir, 'pages/page-001.json'));
    await f.request.get(`${base}/pages/1`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    await writeFile(join(f.dir, 'renders/page-001.png'), '<svg onload="alert(1)"/>');
    await f.request.get(`${base}/pages/1/image`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
  } finally { await f.close(); }
});

test('environment settings are opt-in and invalid values disable private textbook access', () => {
  const env = { NODE_ENV: 'test', HANQ_TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1/hanq_test' };
  assert.deepEqual(loadConfig(env).textbook, { dataDir: null });
  assert.throws(() => loadConfig({ ...env, HANQ_TEXTBOOK_OWNER_USER_ID: '*', HANQ_TEXTBOOK_DATA_DIR: './public' }), /HANQ_TEXTBOOK_DATA_DIR/);
  assert.deepEqual(loadConfig({ ...env, HANQ_TEXTBOOK_OWNER_USER_ID: MEMBER, HANQ_TEXTBOOK_DATA_DIR: '/private/textbook' }).textbook, { dataDir: '/private/textbook' });
  assert.deepEqual(loadConfig({ ...env, HANQ_TEXTBOOK_OWNER_USER_ID: '*', HANQ_TEXTBOOK_DATA_DIR: '/private/textbook' }).textbook, { dataDir: '/private/textbook' });
});

test('missing enhanced asset is 404 and inconsistent page dimensions fail closed', async () => {
  const f = await fixture();
  try {
    await rm(join(f.dir, 'enhanced/page-001.png'));
    await f.request.get(`${base}/pages/1/enhanced`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    await f.request.get(`${base}/pages/1/image`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(200);
    await writeFile(join(f.dir, 'pages/page-001.json'), JSON.stringify({ pdfPage: 1, printedPage: null, width: 999, height: 100, textBlocks: [] }));
    await f.request.get(`${base}/pages/1`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
  } finally { await f.close(); }
});

test('a formerly valid member token loses access on every route after session revocation', async () => {
  const f = await fixture();
  try {
    await f.request.get(`${base}/manifest`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(200);
    f.revokedTokens.add(MEMBER_TOKEN);
    for (const route of routes) {
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(401).expect('Cache-Control', /no-store/);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${OTHER_TOKEN}`).expect(200);
    }
  } finally { await f.close(); }
});

test('only exact server-only bundle is allowed inside the repository; missing bundle and symlinks fail closed', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'hanq-textbook-root-test-'));
  const bundled = join(repo, 'private-textbook-data');
  try {
    await assert.rejects(resolveTextbookDataRoot(null, repo), /Private textbook/);
    await mkdir(bundled);
    assert.equal(await resolveTextbookDataRoot(null, repo), bundled);
    assert.equal(await resolveTextbookDataRoot(undefined, repo), bundled);
    assert.equal(await resolveTextbookDataRoot(bundled, repo), bundled);
    for (const dir of ['public', 'dist', 'other-data', 'private-textbook-data/nested']) {
      const path = join(repo, dir);
      await mkdir(path, { recursive: true });
      await assert.rejects(resolveTextbookDataRoot(path, repo), /Private textbook/);
    }
    await symlink(bundled, join(repo, 'alias'));
    await assert.rejects(resolveTextbookDataRoot(join(repo, 'alias'), repo), /Private textbook/);
    await rm(bundled, { recursive: true });
    await symlink(join(repo, 'public'), bundled);
    await assert.rejects(resolveTextbookDataRoot(null, repo), /Private textbook/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('semantic JSON and figure endpoints require live sessions and fail closed without installed data', async () => {
  const f = await fixture();
  try {
    for (const route of ['semantic/manifest', 'semantic/quizzes/prehistory', 'semantic/pages/12', 'semantic/figures/p012-figure-1']) {
      await f.request.get(`${base}/${route}`).expect(401).expect('Cache-Control', /no-store/);
      await f.request.get(`${base}/${route}`).set('Authorization', 'Bearer revoked-session-token-123456').expect(401);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503).expect('Cache-Control', /no-store/);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${OTHER_TOKEN}`).expect(503);
    }
    for (const route of ['semantic/pages/145', 'semantic/pages/012', 'semantic/pages/%2e%2e%2fmanifest.json', 'semantic/quizzes/other', 'semantic/figures/other']) {
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    }
    await f.request.get('/private-textbook-semantic-data/quizzes/prehistory.json').expect(404);
  } finally { await f.close(); }
});

test('installed semantic JSON fixtures return 200 for two live members without touching repository data', async () => {
  const f = await fixture();
  const root = join(f.dir, 'private-textbook-semantic-data');
  try {
    await mkdir(join(root, 'quizzes'), { recursive: true });
    await mkdir(join(root, 'pages'));
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 'hanq-semantic-manifest/1', quizzes: [{ id: 'prehistory' }], pages: [{ pdfPage: 12 }] }));
    await writeFile(join(root, 'quizzes/prehistory.json'), JSON.stringify({ schemaVersion: 'hanq-source-quiz/1', id: 'prehistory', source: { sha256: 'a'.repeat(64) }, items: [{ id: 'synthetic', text: 'Synthetic test only', segments: [], answers: [], verification: { status: 'source-verified', textVerified: true, answerPairVerified: true } }] }));
    await writeFile(join(root, 'pages/page-012.json'), JSON.stringify({ schemaVersion: 'hanq-semantic/1', pdfPage: 12, sourceSha256: 'a'.repeat(64), width: 100, height: 100, blocks: [] }));
    for (const route of ['semantic/manifest', 'semantic/quizzes/prehistory', 'semantic/pages/12']) {
      await f.request.get(`${base}/${route}`).expect(401);
      for (const token of [MEMBER_TOKEN, OTHER_TOKEN]) {
        await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${token}`).expect(200).expect('Cache-Control', /no-store/);
      }
      f.revokedTokens.add(MEMBER_TOKEN);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(401);
      f.revokedTokens.delete(MEMBER_TOKEN);
    }
    await f.request.get(`${base}/semantic/figures/p012-figure-1`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
  } finally { await f.close(); }
});

test('semantic manifest gates bounded pages and quizzes even when unlisted files exist', async () => {
  const f = await fixture();
  const root = join(f.dir, 'private-textbook-semantic-data');
  try {
    await mkdir(join(root, 'quizzes'), { recursive: true });
    await mkdir(join(root, 'pages'));
    const manifest = { schemaVersion: 'hanq-semantic-manifest/1', pageCount: 2, quizCount: 2, quizzes: [{ id: 'prehistory', itemCount: 1 }, { id: 'ancient', eraId: 'samguk', itemCount: 1 }], pages: [{ pdfPage: 9 }, { pdfPage: 13 }] };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    for (const page of [9, 12, 13]) await writeFile(join(root, `pages/page-${String(page).padStart(3, '0')}.json`), JSON.stringify({ schemaVersion: 'hanq-semantic/1', pdfPage: page, sourceSha256: 'a'.repeat(64), width: 100, height: 100, blocks: [] }));
    for (const id of ['prehistory', 'ancient', 'goryeo']) await writeFile(join(root, `quizzes/${id}.json`), JSON.stringify({ schemaVersion: 'hanq-source-quiz/1', id, eraId: id === 'ancient' ? 'samguk' : id, source: { sha256: 'a'.repeat(64) }, items: [{ id: 'synthetic', text: 'Synthetic only', segments: [], answers: [], verification: { status: 'source-verified', textVerified: true, answerPairVerified: true } }] }));
    for (const route of ['semantic/pages/9', 'semantic/pages/13', 'semantic/quizzes/prehistory', 'semantic/quizzes/ancient']) {
      await f.request.get(`${base}/${route}`).expect(401);
      await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${OTHER_TOKEN}`).expect(200);
    }
    const ancient = await f.request.get(`${base}/semantic/quizzes/ancient`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(200);
    assert.equal(ancient.body.eraId, 'samguk');
    for (const route of ['semantic/pages/12', 'semantic/pages/144', 'semantic/quizzes/goryeo', 'semantic/quizzes/samguk']) await f.request.get(`${base}/${route}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    await rm(join(root, 'pages/page-013.json'));
    await f.request.get(`${base}/semantic/pages/13`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    manifest.quizzes[1].itemCount = 66;
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await f.request.get(`${base}/semantic/quizzes/ancient`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
  } finally { await f.close(); }
});

test('reviewed manifest figures serve JPEG/PNG only, with correct MIME and optional integrity checks', async () => {
  const f = await fixture();
  const root = join(f.dir, 'private-textbook-semantic-data');
  const jpeg = Buffer.from([255, 216, 255, 217]);
  try {
    await mkdir(join(root, 'assets'), { recursive: true });
    const figures: Array<{ id: string; extension?: string; bytes?: number; sha256?: string }> = [
      { id: 'p012-figure-1', bytes: jpeg.length },
      { id: 'p009-figure-2', extension: 'png', bytes: png.length },
      { id: 'p144-figure-999', extension: 'jpeg' },
    ];
    const writeManifest = () => writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 'hanq-semantic-manifest/1', pages: [], quizzes: [], figures }));
    await writeManifest();
    await writeFile(join(root, 'assets/p012-figure-1.jpeg'), jpeg);
    await writeFile(join(root, 'assets/p009-figure-2.png'), png);
    await writeFile(join(root, 'assets/p009-figure-3.png'), png);
    for (const [id, mime] of [['p012-figure-1', 'image/jpeg'], ['p009-figure-2', 'image/png']]) {
      await f.request.get(`${base}/semantic/figures/${id}`).expect(401);
      for (const token of [MEMBER_TOKEN, OTHER_TOKEN]) await f.request.get(`${base}/semantic/figures/${id}`).set('Authorization', `Bearer ${token}`).expect(200).expect('Content-Type', mime).expect('Cache-Control', /no-store/).expect('X-Content-Type-Options', 'nosniff');
    }
    for (const id of ['p009-figure-3', 'p145-figure-1', 'p000-figure-1', 'p009-figure-0', 'p009-figure-1000', 'p009-figure-01', 'p9-figure-1', '%2e%2e%2fmanifest.json']) await f.request.get(`${base}/semantic/figures/${id}`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    await f.request.get(`${base}/semantic/figures/p144-figure-999`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    await writeFile(join(root, 'assets/p009-figure-2.png'), jpeg);
    await f.request.get(`${base}/semantic/figures/p009-figure-2`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    await writeFile(join(root, 'assets/p009-figure-2.png'), png);
    figures[1].sha256 = 'a'.repeat(64);
    await writeManifest();
    await f.request.get(`${base}/semantic/figures/p009-figure-2`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    delete figures[1].sha256;
    figures[1].bytes = 999;
    await writeManifest();
    await f.request.get(`${base}/semantic/figures/p009-figure-2`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
  } finally { await f.close(); }
});

test('derived choices are member-only, manifest-listed, exact-source bound and fail closed on drift', async () => {
  const { createHash } = await import('node:crypto');
  const f = await fixture();
  try {
    const root = join(f.dir, 'private-textbook-semantic-data');
    await mkdir(join(root, 'quizzes/four-choice'), { recursive: true });
    const question = { text: 'Synthetic question', sourceText: '(1) Synthetic question ( )', segments: [{ type: 'text', text: 'Synthetic question' }], source: { pdfPage: 14 } };
    const original = { schemaVersion: 'hanq-source-quiz/1', id: 'prehistory', source: { sha256: 'a'.repeat(64) }, items: ['A', 'B', 'C', 'D'].map((text, index) => ({ id: 'original-' + (index + 1), ...question, answer: { text }, answers: [], verification: { status: 'source-verified', textVerified: true, answerPairVerified: true } })) };
    const sourceBytes = JSON.stringify(original);
    const derived = { schemaVersion: 'hanq-source-four-choice/1', id: 'prehistory-initial-four-choice', eraId: 'prehistory', sourceQuizId: 'prehistory', sourceQuizSha256: createHash('sha256').update(sourceBytes).digest('hex'), items: [{ id: 'derived-1', sourceItemId: 'original-1', sourceQuestion: question, reviewStatus: 'verified', options: ['A', 'B', 'C', 'D'].map((text, index) => ({ id: text, text, sourceRefs: [{ kind: 'original-quiz-answer', quizId: 'prehistory', quizSha256: createHash('sha256').update(sourceBytes).digest('hex'), itemId: 'original-' + (index + 1) }] })), correctOptionId: 'A', verification: { sourceGrounded: true, originalQuestionUnchanged: true } }] };
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 'hanq-semantic-manifest/1', pages: [], quizzes: [{ id: 'prehistory', itemCount: 1 }], fourChoices: [{ id: 'prehistory', itemCount: 1 }] }));
    await writeFile(join(root, 'quizzes/prehistory.json'), sourceBytes);
    const write = () => writeFile(join(root, 'quizzes/four-choice/prehistory.json'), JSON.stringify(derived));
    await write();
    const route = `${base}/semantic/choices/prehistory`;
    await f.request.get(route).expect(401);
    for (const token of [MEMBER_TOKEN, OTHER_TOKEN]) await f.request.get(route).set('Authorization', `Bearer ${token}`).expect(200).expect('Cache-Control', /no-store/);
    await f.request.get(`${base}/semantic/choices/ancient`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    await f.request.get(`${base}/semantic/choices/not-allowed`).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(404);
    derived.items[0].correctOptionId = 'B'; await write();
    await f.request.get(route).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    derived.items[0].correctOptionId = 'A'; derived.items[0].options[1].text = 'A'; await write();
    await f.request.get(route).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    derived.items[0].options[1].text = 'B'; derived.items[0].sourceQuestion.sourceText = 'Changed wording'; await write();
    await f.request.get(route).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
    derived.items[0].sourceQuestion.sourceText = '(1) Synthetic question ( )'; await write();
    await writeFile(join(root, 'quizzes/prehistory.json'), sourceBytes + '\n');
    await f.request.get(route).set('Authorization', `Bearer ${MEMBER_TOKEN}`).expect(503);
  } finally { await f.close(); }
});
