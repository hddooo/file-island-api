import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import type { Response as AgentResponse } from 'superagent';
import { CbtAssetsService } from '../../src/cbt/cbt-assets.service';
import { CBT_DURATION_MS, commonImage, initialPart } from '../../src/cbt/cbt-policy';
import { sha256hex } from '../../src/common/util';
import { seedQuestions } from '../../src/questions/question-seeder';
import { bearer, buyPremium, signin, signup, startApp, type Session, type TestApp } from '../helpers/app';
import { freshDatabase, frontCatalog } from '../helpers/db';
import { TestClock, testConfig } from '../helpers/env';

// Tiny WebP-shaped fixture (RIFF....WEBP header), written to a temp dir only. No original assets are used or copied.
const webp = (tag: string) => {
  const body = Buffer.concat([Buffer.from('WEBPVP8L'), Buffer.from([4, 0, 0, 0]), Buffer.from(tag.padEnd(4, '.').slice(0, 4))]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
};

type Row = { question_id: string; version: string; exam_number: number; points: number; option_ids: string[]; correct_option_id: string; era: string | null; review_payload: Record<string, unknown>; public_payload: Record<string, unknown> };

// Independent current first-completion oracle; historical cbtReward is not the active policy.
const firstRoundReward = (score:number) => score>=80?10:score>=70?5:score>=60?3:-10;

const binary = (res: AgentResponse, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Before grading nothing answer-bearing or static-path-like may appear anywhere in the body. */
function assertNoPregradeLeak(body: unknown) {
  const s = JSON.stringify(body);
  for (const k of ['"correctOptionId"', '"correctNumber"', '"review"', '"correct"', '"answer"', '"explanation"', '"overview"', '"commonImage"', '"imageSha256"', '"text"', '"legacy"', '"source"']) {
    assert.ok(!s.includes(k), `pre-grade body must not contain ${k}`);
  }
  assertNoStaticPaths(body);
}

function assertNoStaticPaths(body: unknown) {
  const s = JSON.stringify(body);
  assert.ok(!/\.(webp|png|jpe?g|gif|svg)\b/i.test(s), 'no static image file names');
  assert.ok(!/(^|["/\\])(media|assets|public|images?)\//i.test(s), 'no static asset paths');
}

describe('authenticated CBT (isolated *_test database)', () => {
  let pool: Pool;
  let t: TestApp;
  let bare: TestApp;
  const clock = new TestClock();
  const assetDir = mkdtempSync(join(tmpdir(), 'hanq-cbt-assets-'));
  const outside = mkdtempSync(join(tmpdir(), 'hanq-cbt-outside-'));
  let A: Session, B: Session;

  const api = () => request(t.server);
  const roundRows = async (round: number) =>
    (await pool.query<Row>(
      `SELECT question_id, version, exam_number, points, option_ids, correct_option_id, era, review_payload, public_payload
         FROM hanq.question_versions WHERE is_current AND kind = 'mock' AND exam_round = $1 ORDER BY exam_number`, [round])).rows;
  const wrongOf = (r: Row) => r.option_ids.find((o) => o !== r.correct_option_id)!;
  const create = (s: Session, round: number, key = randomUUID()) => api().post('/api/v1/cbt/runs').set(bearer(s.access)).send({ round, idempotencyKey: key });
  const start = (s: Session, id: string) => api().post(`/api/v1/cbt/runs/${id}/start`).set(bearer(s.access)).send({});
  const answer = (s: Session, id: string, position: number, optionId: string | null) => api().post(`/api/v1/cbt/runs/${id}/answer`).set(bearer(s.access)).send({ position, optionId });
  const go = (s: Session, id: string, position: number) => api().post(`/api/v1/cbt/runs/${id}/go`).set(bearer(s.access)).send({ position });
  const submit = (s: Session, id: string) => api().post(`/api/v1/cbt/runs/${id}/submit`).set(bearer(s.access)).send({});
  const get = (s: Session, id: string) => api().get(`/api/v1/cbt/runs/${id}`).set(bearer(s.access));
  const image = (s: Session, id: string, pos: number | string, which = 'image') =>
    api().get(`/api/v1/cbt/runs/${id}/questions/${pos}/${which}`).set(bearer(s.access)).buffer(true).parse(binary);
  const attemptsOf = async (runId: string) =>
    (await pool.query<{ submission_id: string; option_id: string | null; correct: boolean; source: string; run_id: string | null; cbt_run_id: string; question_id: string; version: string }>(
      'SELECT submission_id, option_id, correct, source, run_id, cbt_run_id, question_id, version FROM hanq.attempts WHERE cbt_run_id = $1 ORDER BY submission_id', [runId])).rows;
  const growthCount = async (userId: string) => (await pool.query<{ n: number }>('SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id = $1', [userId])).rows[0].n;
  /** Access tokens live 10 minutes: after moving the clock, sign in again for real. */
  const refresh = async (s: Session) => signin(t, s.email);

  before(async () => {
    pool = await freshDatabase(testConfig());
    // Explicit short TTL belongs to this token-expiry scenario, not the production/default policy.
    t = await startApp({ HANQ_CBT_ASSET_DIR: assetDir, HANQ_ACCESS_TTL_SECONDS:'600' }, clock);
    bare = await startApp({}, clock);
    for (let round = 70; round <= 79; round++) for (let n = 1; n <= 50; n++) {
      const number = String(n).padStart(2, '0');
      writeFileSync(join(assetDir, `${round}-${number}.webp`), webp(`q${number}`));
    }
    writeFileSync(join(assetDir, '72-common47-48.webp'), webp('comm'));
    writeFileSync(join(outside, 'secret.webp'), webp('out'));
    A = await signup(t);
    B = await signup(t);
  });
  after(async () => {
    await t.close();
    await bare.close();
    await pool.end();
  });

  it('requires a valid access token on every route, including images', async () => {
    const id = randomUUID();
    for (const [m, p] of [['get', '/api/v1/cbt/rounds'], ['get', '/api/v1/cbt/runs'], ['post', '/api/v1/cbt/runs'], ['get', `/api/v1/cbt/runs/${id}`],
      ['post', `/api/v1/cbt/runs/${id}/start`], ['post', `/api/v1/cbt/runs/${id}/answer`], ['post', `/api/v1/cbt/runs/${id}/go`], ['post', `/api/v1/cbt/runs/${id}/submit`],
      ['get', `/api/v1/cbt/runs/${id}/questions/0/image`], ['get', `/api/v1/cbt/runs/${id}/questions/0/common`], ['get', '/api/v1/cbt/stats']] as const) {
      const r = await request(t.server)[m](p).send({});
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    const bad = await api().get('/api/v1/cbt/rounds').set(bearer('x'.repeat(40)));
    assert.equal(bad.status, 401);
  });

  it('lists only rounds with all private originals ready; missing/corrupt/shared assets stay unavailable', async () => {
    const only79 = mkdtempSync(join(tmpdir(), 'hanq-cbt-only79-'));
    const hashes: Record<string, string> = {};
    for (let n = 1; n <= 50; n++) {
      const name = `79-${String(n).padStart(2, '0')}.webp`, data = webp(`q${n}`);
      writeFileSync(join(only79, name), data);
      hashes[name] = sha256hex(data);
    }
    const manifest = join(only79, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ files: hashes }));
    const partial = await startApp({ HANQ_CBT_ASSET_DIR: only79, HANQ_CBT_ASSET_MANIFEST: manifest }, clock);
    try {
      const count = async () => (await pool.query('SELECT (SELECT count(*) FROM hanq.cbt_runs)::int runs, (SELECT count(*) FROM hanq.attempts)::int attempts')).rows[0];
      const beforeCounts = await count();
      const list = () => request(partial.server).get('/api/v1/cbt/rounds').set(bearer(A.access));
      let r = await list();
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.rounds.filter((x: { available: boolean }) => x.available).map((x: { round: number }) => x.round), [79]);
      assert.ok(r.body.rounds.filter((x: { round: number }) => x.round !== 79).every((x: { available: boolean; reason: string }) => !x.available && x.reason === 'asset_unavailable'));
      writeFileSync(join(only79, '79-50.webp'), webp('bad!'));
      r = await list();
      assert.ok(r.body.rounds.every((x: { available: boolean }) => !x.available), 'manifest mismatch on last question disables79');
      writeFileSync(join(only79, '79-50.webp'), webp('q50'));
      assert.equal((await list()).body.rounds[0].available, true, 'repair is visible immediately');
      unlinkSync(join(only79, '79-01.webp'));
      assert.equal((await list()).body.rounds[0].available, false, 'missing first original disables79');
      const missingConfig = await request(bare.server).get('/api/v1/cbt/rounds').set(bearer(A.access));
      assert.equal(missingConfig.body.imagesConfigured, false);
      assert.ok(missingConfig.body.rounds.every((x: { available: boolean }) => !x.available));
      unlinkSync(join(assetDir, '72-common47-48.webp'));
      try {
        const sharedMissing = await api().get('/api/v1/cbt/rounds').set(bearer(A.access));
        assert.equal(sharedMissing.body.rounds.find((x: { round: number }) => x.round === 72).available, false);
        assert.equal(sharedMissing.body.rounds.find((x: { round: number }) => x.round === 79).available, true);
      } finally { writeFileSync(join(assetDir, '72-common47-48.webp'), webp('comm')); }
      assert.deepEqual(await count(), beforeCounts, 'readiness does not create/reset attempts or runs');
    } finally { await partial.close(); }
  });

  it('public frontend manifest enables all10 rounds without a Render asset directory; auth and server grading remain required', async () => {
    const files = new Map<string, Buffer>(), hashes: Record<string, string> = {};
    for(let round=70;round<=79;round++)for (let n = 1; n <= 50; n++) {
      const name = `${round}-${String(n).padStart(2, '0')}.webp`, buf = webp(`q${n}`);
      files.set('/' + name, buf); hashes[name] = sha256hex(buf);
    }
    const common=webp('comm');files.set('/72-common47-48.webp',common);hashes['72-common47-48.webp']=sha256hex(common);
    files.set('/manifest.json', Buffer.from(JSON.stringify({ files: hashes })));
    let imageRequests=0;const server = createServer((req, res) => { if(req.url!=='/manifest.json')imageRequests++;const buf = files.get(req.url ?? ''); res.statusCode = buf ? 200 : 404; res.end(buf); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const publicApi = await startApp({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: `http://127.0.0.1:${address.port}` }, clock);
    try {
      const P = await signup(publicApi);
      const p = () => request(publicApi.server);
      const publicAssets = new CbtAssetsService(testConfig({ HANQ_CBT_PUBLIC_ASSET_BASE_URL: `http://127.0.0.1:${address.port}` }));
      const canceled = new AbortController(); canceled.abort();
      await assert.rejects(publicAssets.verify(['79-01.webp'], canceled.signal), (e: { code?: string }) => e.code === 'asset_unavailable');
      await assert.rejects(publicAssets.read('../manifest.json'), (e: { getStatus?: () => number }) => e.getStatus?.() === 404);

      assert.equal((await p().get('/api/v1/cbt/rounds')).status, 401);
      const rounds = await p().get('/api/v1/cbt/rounds').set(bearer(P.access));
      assert.equal(rounds.body.imagesConfigured, true);
      assert.deepEqual(rounds.body.rounds.filter((x: { available: boolean }) => x.available).map((x: { round: number }) => x.round), [79,78,77,76,75,74,73,72,71,70]);
      assert.equal(imageRequests,0,'listing reads only manifest, no remote image bytes');
      assert.equal((await p().get('/api/v1/cbt/rounds/78').set(bearer(P.access))).body.rounds.length,1);
      assert.equal((await p().get('/api/v1/cbt/rounds/80').set(bearer(P.access))).status,404);
      const run = await p().post('/api/v1/cbt/runs').set(bearer(P.access)).send({ round: 79, idempotencyKey: randomUUID() });
      assert.equal(run.status, 201); assertNoPregradeLeak(run.body);
      const id = run.body.run.id;
      const started = await p().post(`/api/v1/cbt/runs/${id}/start`).set(bearer(P.access)).send({});
      assert.equal(started.status, 200); assert.equal(started.body.run.status, 'active'); assert.equal(started.body.items.length, 50);
      const binaryResponse = await p().get(`/api/v1/cbt/runs/${id}/questions/0/image`).set(bearer(P.access)).buffer(true).parse(binary);
      assert.equal(binaryResponse.status, 200); assert.ok(binaryResponse.body.equals(files.get('/79-01.webp')));
      assert.equal((await p().get(`/api/v1/cbt/runs/${id}/questions/0/image`)).status, 401);
      const final = await p().post(`/api/v1/cbt/runs/${id}/submit`).set(bearer(P.access)).send({});
      assert.equal(final.status, 200); assert.equal(final.body.run.result.unanswered, 50); assert.equal(final.body.run.result.score, 0);
      files.delete('/79-50.webp');
      assert.equal((await p().get('/api/v1/cbt/rounds').set(bearer(P.access))).body.rounds[0].available, true,'manifest registration remains separate from full start integrity');
      const next=await p().post('/api/v1/cbt/runs').set(bearer(P.access)).send({round:79,idempotencyKey:randomUUID()});
      assert.equal((await p().post(`/api/v1/cbt/runs/${next.body.run.id}/start`).set(bearer(P.access)).send({})).status,503);
      const notStarted=await p().get(`/api/v1/cbt/runs/${next.body.run.id}`).set(bearer(P.access));assert.equal(notStarted.body.run.status,'ready');assert.equal(notStarted.body.run.startedAt,null);
    } finally {
      await publicApi.close(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
  });

  it('ordinary FREE members get all 10 rounds: 50 original questions in order, 5 original numbered choices, 100 points', async () => {
    const rounds = await api().get('/api/v1/cbt/rounds').set(bearer(A.access));
    assert.equal(rounds.status, 200);
    assert.deepEqual(rounds.body.rounds.map((r: { round: number }) => r.round), [79, 78, 77, 76, 75, 74, 73, 72, 71, 70]);
    assert.ok(rounds.body.rounds.every((r: { available: boolean }) => r.available));
    for (let round = 70; round <= 79; round++) {
      const db = await roundRows(round);
      assert.equal(db.length, 50);
      const r = await create(A, round);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.created, true);
      assert.equal(r.body.run.status, 'ready');
      assert.equal(r.body.run.round, round);
      assert.equal(r.body.run.durationMs, 4_800_000);
      assert.equal(r.body.items.length, 50);
      assert.equal(r.body.items.reduce((s: number, i: { points: number }) => s + i.points, 0), 100);
      r.body.items.forEach((it: { position: number; questionId: string; version: string; number: number; exam: number; points: number; options: { id: string; number: number }[]; image: string }, k: number) => {
        assert.equal(it.position, k);
        assert.equal(it.number, k + 1);
        assert.equal(it.exam, round);
        assert.equal(it.questionId, db[k].question_id);
        assert.equal(it.version, db[k].version);
        assert.equal(it.points, db[k].points);
        assert.deepEqual(it.options, db[k].option_ids.map((id, n) => ({ id, number: n + 1 })));
        assert.deepEqual(Object.keys(it.options[0]).sort(), ['id', 'number']);
        assert.equal(it.image, `/api/v1/cbt/runs/${r.body.run.id}/questions/${k}/image`);
      });
      assertNoPregradeLeak(r.body);
    }
  });

  it('validated DTOs: unknown fields (incl. userId), bad rounds and malformed keys are rejected', async () => {
    const key = randomUUID();
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: 79, idempotencyKey: key, userId: B.userId })).status, 400);
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: 69, idempotencyKey: key })).status, 400);
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: 80, idempotencyKey: key })).status, 400);
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: '79', idempotencyKey: key })).status, 400);
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: 79, idempotencyKey: '../x' })).status, 400);
    assert.equal((await api().post('/api/v1/cbt/runs').set(bearer(A.access)).send({ round: 79 })).status, 400);
  });

  it('create is idempotent per owner key (also concurrently); other owners are isolated; another round under the same key conflicts', async () => {
    const key = randomUUID();
    const many = await Promise.all(Array.from({ length: 6 }, () => create(A, 79, key)));
    for (const r of many) assert.equal(r.status, 201, JSON.stringify(r.body));
    const ids = new Set(many.map((r) => r.body.run.id));
    assert.equal(ids.size, 1);
    assert.equal(many.filter((r) => r.body.created).length, 1);
    const n = await pool.query('SELECT count(*)::int n FROM hanq.cbt_runs WHERE user_id = $1 AND idempotency_key = $2', [A.userId, key]);
    assert.equal(n.rows[0].n, 1);
    const items = await pool.query('SELECT count(*)::int n FROM hanq.cbt_run_items WHERE run_id = $1', [[...ids][0]]);
    assert.equal(items.rows[0].n, 50);
    const other = await create(B, 79, key);
    assert.equal(other.status, 201);
    assert.notEqual(other.body.run.id, [...ids][0]);
    const conflict = await create(A, 78, key);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'idempotency_conflict');
  });

  it("another owner's run is 404 on every read, write and image route; so are malformed ids", async () => {
    const run = (await create(A, 79)).body.run;
    await start(A, run.id);
    const probes = [
      get(B, run.id), start(B, run.id), answer(B, run.id, 0, null), go(B, run.id, 3), submit(B, run.id), image(B, run.id, 0), image(B, run.id, 0, 'common'),
      get(A, 'not-a-uuid'), get(A, randomUUID()),
    ];
    for (const r of await Promise.all(probes)) assert.equal(r.status, 404);
    const list = await api().get('/api/v1/cbt/runs').set(bearer(B.access));
    assert.ok(!list.body.runs.some((r: { id: string }) => r.id === run.id));
    const still = await get(A, run.id);
    assert.equal(still.body.run.status, 'active');
    assert.equal(still.body.run.currentPosition, 0);
  });

  it('ready → explicit start sets an 80-minute server deadline; repeated start is idempotent', async () => {
    const run = (await create(A, 76)).body.run;
    const early = await answer(A, run.id, 0, null);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'run_not_started');
    assert.equal((await image(A, run.id, 0)).status, 409);
    assert.equal((await submit(A, run.id)).body.error.code, 'run_not_started');
    const s1 = await start(A, run.id);
    assert.equal(s1.status, 200);
    assert.equal(s1.body.run.status, 'active');
    assert.equal(s1.body.run.startedAt, clock.now().toISOString());
    assert.equal(Date.parse(s1.body.run.endsAt) - Date.parse(s1.body.run.startedAt), CBT_DURATION_MS);
    assert.equal(s1.body.run.remainingMs, CBT_DURATION_MS);
    clock.advance(60_000);
    const s2 = await start(A, run.id);
    assert.equal(s2.body.run.startedAt, s1.body.run.startedAt);
    assert.equal(s2.body.run.endsAt, s1.body.run.endsAt);
    assert.equal(s2.body.run.remainingMs, CBT_DURATION_MS - 60_000);
    assertNoPregradeLeak(s2.body);
  });

  it('answers and the current position are saved; invalid edits are rejected; concurrent edits all land (row lock)', async () => {
    A = await refresh(A);
    const db = await roundRows(75);
    const run = (await create(A, 75)).body.run;
    await start(A, run.id);
    assert.equal((await answer(A, run.id, 0, db[0].option_ids[2])).status, 200);
    assert.equal((await answer(A, run.id, 1, db[1].option_ids[0])).status, 200);
    const cleared = await answer(A, run.id, 1, null);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.item.selectedOptionId, null);
    const moved = await go(A, run.id, 7);
    assert.equal(moved.status, 200);
    assert.equal(moved.body.run.currentPosition, 7);
    assertNoPregradeLeak(moved.body);
    assertNoPregradeLeak(cleared.body);
    // invalid edits
    assert.equal((await answer(A, run.id, 2, db[3].option_ids[0])).status, 400);
    assert.equal((await answer(A, run.id, 50, db[0].option_ids[0])).status, 400);
    assert.equal((await answer(A, run.id, -1, null)).status, 400);
    assert.equal((await api().post(`/api/v1/cbt/runs/${run.id}/answer`).set(bearer(A.access)).send({ position: 2 })).status, 400);
    assert.equal((await api().post(`/api/v1/cbt/runs/${run.id}/answer`).set(bearer(A.access)).send({ position: 2, optionId: null, correct: true })).status, 400);
    assert.equal((await api().post(`/api/v1/cbt/runs/${run.id}/go`).set(bearer(A.access)).send({ position: 2, userId: A.userId })).status, 400);
    // concurrent edits on different positions
    const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => answer(A, run.id, 10 + k, db[10 + k].option_ids[k % 5])));
    for (const r of rs) assert.equal(r.status, 200);
    // concurrent edits on the same position: one of them wins, none fails
    const same = await Promise.all(db[40].option_ids.map((o) => answer(A, run.id, 40, o)));
    for (const r of same) assert.equal(r.status, 200);
    const view = await get(A, run.id);
    assert.equal(view.body.items[0].selectedOptionId, db[0].option_ids[2]);
    assert.equal(view.body.items[1].selectedOptionId, null);
    for (let k = 0; k < 20; k++) assert.equal(view.body.items[10 + k].selectedOptionId, db[10 + k].option_ids[k % 5]);
    assert.ok(db[40].option_ids.includes(view.body.items[40].selectedOptionId));
    assert.equal(view.body.run.currentPosition, 7);
    assert.equal(view.body.run.answered, 22);
    assertNoPregradeLeak(view.body);
  });

  it('a run survives reload, token expiry and a fresh sign-in (durable server state)', async () => {
    const db = await roundRows(74);
    const run = (await create(A, 74)).body.run;
    await start(A, run.id);
    await answer(A, run.id, 5, db[5].option_ids[1]);
    await go(A, run.id, 5);
    clock.advance(11 * 60_000); // access token (10 min) is now expired
    assert.equal((await get(A, run.id)).status, 401);
    A = await refresh(A);
    const again = await get(A, run.id);
    assert.equal(again.status, 200);
    assert.equal(again.body.run.status, 'active');
    assert.equal(again.body.run.currentPosition, 5);
    assert.equal(again.body.items[5].selectedOptionId, db[5].option_ids[1]);
    const list = await api().get('/api/v1/cbt/runs').set(bearer(A.access));
    const mine = list.body.runs.find((r: { id: string }) => r.id === run.id);
    assert.equal(mine.status, 'active');
    assert.equal(mine.answered, 1);
    assertNoPregradeLeak(list.body);
  });

  let gradedRun: { id: string; wrongIds: string[] };

  it('weighted score, grade, era/part statistics with explicit denominators, one-time attempts, ONE final-score growth row (009), none per question', async () => {
    A = await refresh(A);
    const growthBefore = await growthCount(A.userId);
    const studyRunsBefore = (await pool.query('SELECT count(*)::int n FROM hanq.runs WHERE user_id = $1', [A.userId])).rows[0].n;
    const db = await roundRows(78);
    const parts = db.map((r) => initialPart(r.review_payload));
    const counts = new Map<string, number>();
    parts.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
    const [bigPart, bigTotal] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    assert.ok(bigTotal >= 2);
    const wrongPos = parts.map((p, k) => (p === bigPart ? k : -1)).filter((k) => k >= 0).slice(0, 2);
    const skipPos = parts.findIndex((p) => p !== bigPart);
    const run = (await create(A, 78)).body.run;
    await start(A, run.id);
    for (let k = 0; k < 50; k++) {
      if (k === skipPos) continue;
      const r = await answer(A, run.id, k, wrongPos.includes(k) ? wrongOf(db[k]) : db[k].correct_option_id);
      assert.equal(r.status, 200);
    }
    const pre = await get(A, run.id);
    assertNoPregradeLeak(pre.body);

    const done = await submit(A, run.id);
    assert.equal(done.status, 200);
    const res = done.body.run.result;
    const lost = wrongPos.reduce((s, k) => s + db[k].points, 0) + (skipPos >= 0 ? db[skipPos].points : 0);
    assert.equal(res.score, 100 - lost);
    assert.equal(res.maxScore, 100);
    assert.equal(res.correct, 50 - 2 - (skipPos >= 0 ? 1 : 0));
    assert.equal(res.wrong, 2);
    assert.equal(res.unanswered, skipPos >= 0 ? 1 : 0);
    const expectGrade = res.score >= 80 ? 1 : res.score >= 70 ? 2 : res.score >= 60 ? 3 : null;
    assert.equal(res.grade, expectGrade);
    assert.equal(done.body.run.finalReason, 'submit');

    // part statistics: the denominator is the part's total (2/T), not its wrong count (2/2)
    const big = res.stats.parts.buckets.find((b: { key: string }) => b.key === bigPart);
    assert.equal(big.total, bigTotal);
    assert.equal(big.wrong, 2);
    assert.equal(big.wrongRate, 2 / bigTotal);
    assert.equal(res.stats.parts.verified, false);
    for (const b of [...res.stats.parts.buckets, ...res.stats.eras.buckets]) {
      assert.equal(b.wrong, b.total - b.correct);
      assert.equal(b.unanswered, b.total - b.answered);
      assert.equal(b.wrongRate, b.total ? b.wrong / b.total : null);
    }
    if (skipPos >= 0) {
      const p = res.stats.parts.buckets.find((b: { key: string }) => b.key === parts[skipPos]);
      assert.ok(p.unanswered >= 1 && p.wrong >= 1, 'unanswered counts as wrong in statistics');
    }
    const eraTotal = res.stats.eras.buckets.reduce((s: number, b: { total: number }) => s + b.total, 0);
    assert.equal(eraTotal + res.stats.eras.excluded.count, 50);
    assert.equal(res.stats.parts.buckets.reduce((s: number, b: { total: number }) => s + b.total, 0), 50);

    // full review for all 50, owner only, after grading; no static paths anywhere
    assert.equal(done.body.items.length, 50);
    for (const [k, item] of done.body.items.entries()) {
      assert.equal(item.review.correctOptionId, db[k].correct_option_id);
      assert.equal(item.review.options.length, 5);
      assert.deepEqual(item.review.options.map((o: { number: number }) => o.number), [1, 2, 3, 4, 5]);
      assert.ok(item.review.options.every((o: object) => 'explanation' in o));
      assert.equal(item.review.status, k === skipPos ? 'unanswered' : wrongPos.includes(k) ? 'wrong' : 'correct');
      assert.equal(item.review.part, parts[k]);
      if (item.review.link) assert.equal(item.review.link.eraId, item.review.era);
    }
    assertNoStaticPaths(done.body);

    // exactly 50 attempts, once: source run, run_id NULL, cbt_run_id linked, unanswered NULL+wrong
    const at = await attemptsOf(run.id);
    assert.equal(at.length, 50);
    assert.ok(at.every((a) => a.source === 'run' && a.run_id === null && a.cbt_run_id === run.id));
    assert.deepEqual(at.map((a) => a.submission_id).sort(), db.map((_, k) => `cbt-${run.id}-${k}`).sort());
    if (skipPos >= 0) {
      const u = at.find((a) => a.submission_id === `cbt-${run.id}-${skipPos}`)!;
      assert.equal(u.option_id, null);
      assert.equal(u.correct, false);
    }
    // repeat submit / reads: same immutable result, no duplicate attempts
    const again = await submit(A, run.id);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.run.result, res);
    assert.equal(again.body.run.finalAt, done.body.run.finalAt);
    await get(A, run.id);
    await api().get('/api/v1/cbt/runs').set(bearer(A.access));
    await api().get('/api/v1/cbt/stats').set(bearer(A.access));
    assert.equal((await attemptsOf(run.id)).length, 50);
    // edits after grading are refused and not stored
    const late = await answer(A, run.id, 0, wrongOf(db[0]));
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'run_final');
    assert.equal((await go(A, run.id, 3)).body.error.code, 'run_final');
    await assert.rejects(pool.query(`UPDATE hanq.cbt_runs SET result = '{}' WHERE id = $1`, [run.id]), /immutable/);
    await assert.rejects(pool.query('DELETE FROM hanq.cbt_run_items WHERE run_id=$1', [run.id]), /immutable/);
    await assert.rejects(pool.query('DELETE FROM hanq.cbt_runs WHERE id=$1', [run.id]), /immutable/);
    // exactly one final-score growth row for the run (never per question); no challenge / study-run writes
    assert.equal(await growthCount(A.userId), growthBefore + 1);
    const g = await pool.query<{ kind: string; amount: number; cbt_run_id: string; event_key: string }>(`SELECT kind, amount, cbt_run_id, event_key FROM hanq.growth_ledger WHERE user_id = $1 AND kind = 'cbt-exam'`, [A.userId]);
    assert.deepEqual(g.rows.map((x) => [x.kind, x.amount, x.cbt_run_id, x.event_key]), [['cbt-exam', firstRoundReward(res.score), run.id, 'cbt:' + run.id]]);
    assert.equal(res.growthReward, firstRoundReward(res.score), 'immutable result carries the current first-round reward');
    assert.equal(res.rewardEligible,true);assert.equal(res.growthPolicy,'round-first-score-bands-v1');assert.equal(res.policyGrowthReward,firstRoundReward(res.score));
    assert.equal((await pool.query(`SELECT count(*)::int n FROM hanq.growth_ledger g JOIN hanq.attempts a ON a.id = g.attempt_id WHERE a.cbt_run_id = $1`, [run.id])).rows[0].n, 0, 'no per-question practice rewards for CBT attempts');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.runs WHERE user_id = $1', [A.userId])).rows[0].n, studyRunsBefore);
    gradedRun = { id: run.id, wrongIds: [...wrongPos, ...(skipPos >= 0 ? [skipPos] : [])].map((k) => db[k].question_id) };

    const stats = await api().get('/api/v1/cbt/stats').set(bearer(A.access));
    assert.equal(stats.status, 200);
    assert.ok(stats.body.runs >= 1);
  });

  it('existing wrong notes derive the CBT wrong answers; the existing premium gate is unchanged', async () => {
    const free = await api().get('/api/v1/wrong-notes').set(bearer(A.access));
    assert.equal(free.status, 403, 'wrong-note list keeps its existing premium gate');
    await buyPremium(t, A);
    const notes = await api().get('/api/v1/wrong-notes').set(bearer(A.access));
    assert.equal(notes.status, 200);
    const ids = new Set(notes.body.items.map((i: { questionId: string }) => i.questionId));
    for (const q of gradedRun.wrongIds) assert.ok(ids.has(q), `${q} appears in wrong notes`);
  });

  it('the deadline finalizes once with answers saved before it; a late answer is never saved', async () => {
    let D = await signup(t);
    const db = await roundRows(77);
    const run = (await create(D, 77)).body.run;
    const s = (await start(D, run.id)).body.run;
    await answer(D, run.id, 0, db[0].correct_option_id);
    clock.set(new Date(Date.parse(s.endsAt) - 1));
    D = await refresh(D);
    assert.equal((await answer(D, run.id, 1, db[1].correct_option_id)).status, 200, 'still in time 1 ms before the deadline');
    clock.advance(1); // now === deadline
    const late = await answer(D, run.id, 2, db[2].correct_option_id);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'run_expired');
    const view = await get(D, run.id);
    assert.equal(view.body.run.status, 'final');
    assert.equal(view.body.run.finalReason, 'expired');
    assert.equal(view.body.run.finalAt, s.endsAt);
    assert.equal(view.body.items[2].selectedOptionId, null);
    assert.equal(view.body.run.result.score, db[0].points + db[1].points);
    assert.equal(view.body.run.result.answered, 2);
    assert.equal(view.body.run.result.unanswered, 48);
    assert.equal((await attemptsOf(run.id)).length, 50);
    const sub = await submit(D, run.id);
    assert.equal(sub.status, 200);
    assert.deepEqual(sub.body.run.result, view.body.run.result);
    assert.equal((await go(D, run.id, 1)).body.error.code, 'run_expired');
    assert.equal((await attemptsOf(run.id)).length, 50);
    const eg = await pool.query<{ amount: number }>(`SELECT amount FROM hanq.growth_ledger WHERE cbt_run_id = $1`, [run.id]);
    assert.deepEqual(eg.rows.map((x) => x.amount), [-10], 'first completion below60: one -10, unchanged by the later submit');

    // listing alone also finalizes a run that is past its deadline
    const run2 = (await create(D, 73)).body.run;
    await start(D, run2.id);
    clock.advance(CBT_DURATION_MS + 5_000);
    D = await refresh(D);
    const list = await api().get('/api/v1/cbt/runs').set(bearer(D.access));
    assert.equal(list.body.runs.find((r: { id: string }) => r.id === run2.id).status, 'final');
    assert.equal((await attemptsOf(run2.id)).length, 50);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM hanq.growth_ledger WHERE cbt_run_id = $1`, [run2.id])).rows[0].n, 1, 'listing finalizes with exactly one reward');
    // finalized 5 s after the deadline: the result keeps the deadline, the 50 attempts carry the real confirmation time (no backdating)
    const confirmed = await pool.query<{ created_at: Date }>('SELECT DISTINCT created_at FROM hanq.attempts WHERE cbt_run_id = $1', [run2.id]);
    assert.deepEqual(confirmed.rows.map((x) => x.created_at.getTime()), [clock.now().getTime()]);
    assert.equal((await pool.query<{ final_at: Date; ends_at: Date }>('SELECT final_at, ends_at FROM hanq.cbt_runs WHERE id = $1', [run2.id])).rows.map((x) => x.final_at.getTime() === x.ends_at.getTime())[0], true);
  });

  it('samples the server clock after a row-lock wait crosses the deadline', async () => {
    const s = await signup(t), run = (await create(s, 79)).body.run;
    await start(s, run.id);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM hanq.cbt_runs WHERE id=$1 FOR UPDATE', [run.id]);
      const pending = answer(s, run.id, 0, (await roundRows(79))[0].correct_option_id).then(r => r);
      let waiting = false;
      for (let i=0; i<200; i++) {
        const r = await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%cbt_runs%'");
        if (r.rows[0].n > 0) { waiting=true; break; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.ok(waiting, 'request really waits for the row lock');
      clock.advance(CBT_DURATION_MS);
      await blocker.query('COMMIT');
      const late = await pending;
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, 'run_expired');
      const fresh = await refresh(s), view = await get(fresh, run.id);
      assert.equal(view.body.run.status, 'final');
      assert.equal(view.body.items[0].selectedOptionId, null);
      assert.equal((await attemptsOf(run.id)).length, 50);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('submit racing with edits: one grading, exactly 50 attempts, result matches stored answers', async () => {
    let E = await signup(t);
    const db = await roundRows(72);
    const run = (await create(E, 72)).body.run;
    await start(E, run.id);
    const out = await Promise.all([
      ...Array.from({ length: 8 }, (_, k) => answer(E, run.id, k, db[k].correct_option_id)),
      submit(E, run.id), submit(E, run.id),
      ...Array.from({ length: 8 }, (_, k) => answer(E, run.id, 20 + k, db[20 + k].correct_option_id)),
    ]);
    for (const r of out) assert.ok(r.status === 200 || (r.status === 409 && r.body.error.code === 'run_final'), `${r.status} ${JSON.stringify(r.body)}`);
    E = await refresh(E);
    const view = await get(E, run.id);
    assert.equal(view.body.run.status, 'final');
    const saved = view.body.items.filter((i: { selectedOptionId: string | null }) => i.selectedOptionId !== null).length;
    assert.equal(view.body.run.result.answered, saved);
    assert.equal(view.body.run.result.correct, saved);
    assert.equal((await attemptsOf(run.id)).length, 50);
    const g = await pool.query<{ amount: number }>(`SELECT amount FROM hanq.growth_ledger WHERE cbt_run_id = $1`, [run.id]);
    assert.deepEqual(g.rows.map((x) => x.amount), [firstRoundReward(view.body.run.result.score)], 'concurrent submits: one reward');
  });

  it('protected images: owner-only binary WebP, private no-store; traversal, symlink escape, bad and missing files refused', async () => {
    let C = await signup(t);
    B = await refresh(B);
    const run = (await create(C, 79)).body.run;
    await start(C, run.id);
    const ok = await image(C, run.id, 0);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/webp');
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.ok(Buffer.isBuffer(ok.body));
    assert.ok((ok.body as Buffer).equals(webp('q01')));
    assert.equal(ok.headers.location, undefined);

    unlinkSync(join(assetDir, '79-02.webp'));
    unlinkSync(join(assetDir, '79-03.webp'));
    symlinkSync(join(outside, 'secret.webp'), join(assetDir, '79-03.webp'));
    writeFileSync(join(assetDir, '79-04.webp'), Buffer.from('not an image at all'));
    const missing = await image(C, run.id, 1);
    assert.equal(missing.status, 503);
    assert.equal(JSON.parse((missing.body as Buffer).toString('utf8')).error.code, 'asset_unavailable');
    const escape = await image(C, run.id, 2);
    assert.equal(escape.status, 503, 'a symlink pointing outside the private directory is refused');
    assert.ok(!(escape.body as Buffer).includes(Buffer.from('out')));
    assert.equal((await image(C, run.id, 3)).status, 503, 'not a WebP');
    for (const p of ['..%2F..%2Fetc%2Fpasswd', '..', '1.5', '050', '50', '-1', '%2e%2e']) {
      assert.equal((await image(C, run.id, p)).status, 404, p);
    }
    assert.equal((await image(B, run.id, 0)).status, 404);

    const svc = new CbtAssetsService(testConfig({ HANQ_CBT_ASSET_DIR: assetDir }));
    for (const bad of ['../79-01.webp', '79-01.webp/..', '/etc/passwd', '79-01.png', '79-1.webp', '69-01.webp', 'x/79-01.webp', '79-01.webp\u0000']) {
      await assert.rejects(svc.read(bad), (e: { getStatus?: () => number }) => e.getStatus?.() === 404, bad);
    }
    // the asset directory itself may be reached through a symlink (it is resolved first)
    const link = join(mkdtempSync(join(tmpdir(), 'hanq-cbt-link-')), 'assets');
    symlinkSync(assetDir, link);
    assert.ok((await new CbtAssetsService(testConfig({ HANQ_CBT_ASSET_DIR: link })).read('79-01.webp')).equals(webp('q01')));
    // relative paths are ignored (never resolved against the working directory)
    assert.equal(testConfig({ HANQ_CBT_ASSET_DIR: 'relative/assets' }).cbt?.assetDir, null);

    // optional manifest: canonical file-name → sha256 evidence
    const manifest = join(mkdtempSync(join(tmpdir(), 'hanq-cbt-manifest-')), 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ files: { '79-01.webp': sha256hex(webp('q01')) } }));
    assert.ok((await new CbtAssetsService(testConfig({ HANQ_CBT_ASSET_DIR: assetDir, HANQ_CBT_ASSET_MANIFEST: manifest })).read('79-01.webp')).equals(webp('q01')));
    writeFileSync(manifest, JSON.stringify({ files: { '79-01.webp': 'a'.repeat(64) } }));
    await assert.rejects(new CbtAssetsService(testConfig({ HANQ_CBT_ASSET_DIR: assetDir, HANQ_CBT_ASSET_MANIFEST: manifest })).read('79-01.webp'), (e: { getStatus?: () => number }) => e.getStatus?.() === 503);

    unlinkSync(join(assetDir, '79-03.webp'));
    for (const n of ['02', '03', '04']) writeFileSync(join(assetDir, `79-${n}.webp`), webp(`q${n}`));
    // shared passage image, when a question declares one
    const common = (await pool.query<{ exam_round: number; exam_number: number; public_payload: Record<string, unknown> }>(
      `SELECT exam_round, exam_number, public_payload FROM hanq.question_versions WHERE is_current AND kind = 'mock' AND public_payload ? 'commonImage' AND exam_round BETWEEN 70 AND 79 ORDER BY exam_round DESC, exam_number LIMIT 1`)).rows[0];
    const noCommon = (await roundRows(79)).findIndex((r) => !commonImage(79, r.exam_number, r.public_payload));
    if (noCommon >= 0) assert.equal((await image(C, run.id, noCommon, 'common')).status, 404);
    if (common) {
      const c = commonImage(common.exam_round, common.exam_number, common.public_payload);
      if (c) {
        writeFileSync(join(assetDir, c.name), webp('cmn'));
        C = await refresh(C);
        const crun = (await create(C, common.exam_round)).body.run;
        const started = await start(C, crun.id);
        const item = started.body.items[common.exam_number - 1];
        assert.deepEqual(item.common, { image: `/api/v1/cbt/runs/${crun.id}/questions/${common.exam_number - 1}/common`, questionNumbers: c.numbers });
        const r = await image(C, crun.id, common.exam_number - 1, 'common');
        assert.equal(r.status, 200);
        assert.equal(r.headers['content-type'], 'image/webp');
        assert.equal(r.headers['cache-control'], 'private, no-store');
        assert.ok((r.body as Buffer).equals(webp('cmn')));
        assertNoPregradeLeak(started.body);
      }
    }
  });

  it('without private originals starting is refused; no clock or attempts begin; sign-up keeps working', async () => {
    const s = await signup(bare);
    const rounds = await request(bare.server).get('/api/v1/cbt/rounds').set(bearer(s.access));
    assert.equal(rounds.status, 200);
    assert.equal(rounds.body.imagesConfigured, false);
    const run = (await request(bare.server).post('/api/v1/cbt/runs').set(bearer(s.access)).send({ round: 79, idempotencyKey: randomUUID() })).body.run;
    const started = await request(bare.server).post(`/api/v1/cbt/runs/${run.id}/start`).set(bearer(s.access)).send({});
    assert.equal(started.status, 503);
    assert.equal(started.body.error.code, 'asset_unavailable');
    const unchanged = await request(bare.server).get(`/api/v1/cbt/runs/${run.id}`).set(bearer(s.access));
    assert.equal(unchanged.body.run.status, 'ready');
    assert.equal(unchanged.body.run.startedAt, null);
    assert.equal((await attemptsOf(run.id)).length, 0);
  });

  it('rounds are validated exactly; a missing question makes the round unavailable (never filled in)', async () => {
    A = await refresh(A);
    const victim = (await roundRows(70))[10];
    await pool.query('UPDATE hanq.question_versions SET is_current = false WHERE question_id = $1 AND version = $2', [victim.question_id, victim.version]);
    try {
      const rounds = await api().get('/api/v1/cbt/rounds').set(bearer(A.access));
      const r70 = rounds.body.rounds.find((r: { round: number }) => r.round === 70);
      assert.equal(r70.available, false);
      const c = await create(A, 70);
      assert.equal(c.status, 409);
      assert.equal(c.body.error.code, 'round_unavailable');
    } finally {
      await pool.query('UPDATE hanq.question_versions SET is_current = true WHERE question_id = $1 AND version = $2', [victim.question_id, victim.version]);
    }
  });

  it('historical versions stay linked: a re-seeded question version does not change a graded run', async () => {
    A = await refresh(A);
    const before = await get(A, gradedRun.id);
    const items = frontCatalog().map((q) => ({ ...q }));
    const i = items.findIndex((q) => q.questionId === 'exam-78-01');
    assert.ok(i >= 0);
    const oldVersion = items[i].version;
    items[i] = { ...items[i], version: oldVersion + '-cbt2', contentHash: 'd'.repeat(64) };
    try {
      await seedQuestions(pool, items, new Date('2026-10-09T00:00:00Z'));
      const afterSeed = await get(A, gradedRun.id);
      assert.equal(afterSeed.body.items[0].version, oldVersion);
      assert.deepEqual(afterSeed.body.run.result, before.body.run.result);
      assert.equal(afterSeed.body.items[0].review.correctOptionId, before.body.items[0].review.correctOptionId);
      const fresh = await create(A, 78);
      assert.equal(fresh.status, 201);
      assert.equal(fresh.body.items[0].version, oldVersion + '-cbt2');
    } finally {
      await seedQuestions(pool, frontCatalog(), new Date('2026-10-09T00:00:00Z'));
    }
  });
  it('batch pause preserves time, rejects per-answer writes, validates and grades exactly once', async()=>{
    let owner=await signup(t);const rows=await roundRows(79);
    const c=await api().post('/api/v1/cbt/runs').set(bearer(owner.access)).send({round:79,idempotencyKey:randomUUID(),answerMode:'batch'});
    assert.equal(c.status,201);const id=c.body.run.id;
    let r=await start(owner,id);assert.equal(r.body.run.remainingMs,CBT_DURATION_MS);
    clock.advance(120000);r=await api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(owner.access)).send({});assert.equal(r.status,200);const remaining=r.body.run.remainingMs;
    clock.advance(3600000);owner=await refresh(owner);
    r=await get(owner,id);assert.equal(r.body.run.paused,true);assert.equal(r.body.run.remainingMs,remaining);
    assert.equal((await image(owner,id,0)).status,409);
    r=await api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(owner.access)).send({});assert.equal(r.body.run.remainingMs,remaining);
    r=await api().post(`/api/v1/cbt/runs/${id}/resume`).set(bearer(owner.access)).send({});assert.equal(r.body.run.remainingMs,remaining);const end=r.body.run.endsAt;
    r=await api().post(`/api/v1/cbt/runs/${id}/resume`).set(bearer(owner.access)).send({});assert.equal(r.body.run.endsAt,end);
    assert.equal((await answer(owner,id,0,rows[0].correct_option_id)).status,409);
    const body={submissionKey:randomUUID(),currentPosition:49,answers:rows.map((q,position)=>({position,optionId:q.correct_option_id}))};
    const post=(b:object)=>api().post(`/api/v1/cbt/runs/${id}/submit`).set(bearer(owner.access)).send(b);
    const bad=structuredClone(body);bad.answers[49].position=0;assert.equal((await post(bad)).status,400);
    assert.equal((await attemptsOf(id)).length,0);assert.equal((await get(owner,id)).body.run.answered,0);
    const results=await Promise.all([post(body),post(body)]);for(const x of results){assert.equal(x.status,200);assert.equal(x.body.run.result.score,100);}
    assert.equal((await attemptsOf(id)).length,50);assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE cbt_run_id=$1',[id])).rows[0].n,1);
    bad.answers[49].position=49;bad.answers[0].optionId=wrongOf(rows[0]);assert.equal((await post(bad)).status,409);
    assertNoPregradeLeak(c.body);
  });

  it('late batch waits for its frozen full submission; legacy upgrade retains saved answers and deadline',async()=>{
    let owner=await signup(t);const rows=await roundRows(79);
    let r=await create(owner,79);const id=r.body.run.id;r=await start(owner,id);const end=r.body.run.endsAt;
    await answer(owner,id,0,rows[0].correct_option_id);
    r=await api().post(`/api/v1/cbt/runs/${id}/batch`).set(bearer(owner.access)).send({});assert.equal(r.status,200);assert.equal(r.body.run.endsAt,end);assert.equal(r.body.items[0].selectedOptionId,rows[0].correct_option_id);
    clock.advance(CBT_DURATION_MS+1000);owner=await refresh(owner);r=await get(owner,id);assert.equal(r.body.run.status,'active');assert.equal(r.body.run.remainingMs,0);assert.equal((await attemptsOf(id)).length,0);
    assert.equal((await api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(owner.access)).send({})).status,409);
    const body={submissionKey:randomUUID(),answers:rows.map((q,position)=>({position,optionId:position===0?q.correct_option_id:null}))};
    r=await api().post(`/api/v1/cbt/runs/${id}/submit`).set(bearer(owner.access)).send(body);assert.equal(r.status,200);assert.equal(r.body.run.finalReason,'expired');assert.equal(r.body.run.finalAt,end);assert.equal((await attemptsOf(id)).length,50);
  });


  it('pause atomically checkpoints all answers and position, survives a new client and never grades',async()=>{
    const owner=await signup(t),other=await signup(t),rows=await roundRows(79);
    const c=await api().post('/api/v1/cbt/runs').set(bearer(owner.access)).send({round:79,idempotencyKey:randomUUID(),answerMode:'batch'});const id=c.body.run.id;await start(owner,id);
    const body={submissionKey:randomUUID(),checkpointVersion:0,currentPosition:49,answers:rows.map((q,position)=>({position,optionId:position%2===0?q.correct_option_id:null}))};
    const post=(payload:object=body)=>api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(owner.access)).send(payload);
    const invalid=structuredClone(body);invalid.answers[49].position=0;assert.equal((await post(invalid)).status,400);assert.equal((await get(owner,id)).body.run.answered,0);
    const results=await Promise.all([post(),post()]);for(const r of results){assert.equal(r.status,200);assert.equal(r.body.run.paused,true);assert.equal(r.body.run.answered,25);assert.equal(r.body.run.currentPosition,49);assert.equal(r.body.run.checkpointVersion,1);assert.equal(r.body.run.pauseSubmissionKey,body.submissionKey);}
    const fresh=await get(await refresh(owner),id);assert.equal(fresh.body.run.answered,25);assert.equal(fresh.body.run.currentPosition,49);assert.deepEqual(fresh.body.items.map((q:{selectedOptionId:string|null})=>q.selectedOptionId),body.answers.map(a=>a.optionId));assert.equal((await attemptsOf(id)).length,0);
    assert.equal((await api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(other.access)).send(body)).status,404);
    const changed=structuredClone(body);changed.answers[0].optionId=wrongOf(rows[0]);assert.equal((await post(changed)).status,409);
    await api().post(`/api/v1/cbt/runs/${id}/resume`).set(bearer(owner.access)).send({});const replay=await post();assert.equal(replay.body.run.paused,false);assert.equal(replay.body.run.checkpointVersion,1);
    assert.equal((await post({...body,submissionKey:randomUUID(),checkpointVersion:0})).status,409);assert.equal((await get(owner,id)).body.run.paused,false);assert.equal((await get(owner,id)).body.run.checkpointVersion,1);
    const finalBody={submissionKey:randomUUID(),currentPosition:49,answers:body.answers};const graded=await api().post(`/api/v1/cbt/runs/${id}/submit`).set(bearer(owner.access)).send(finalBody);assert.equal(graded.status,200);assert.equal((await post()).status,409);assert.equal((await attemptsOf(id)).length,50);assert.deepEqual((await get(owner,id)).body.run.result,graded.body.run.result);
  });

  it('a DB failure after answer update rolls back the whole pause checkpoint',async()=>{
    const owner=await signup(t),rows=await roundRows(79);
    const c=await api().post('/api/v1/cbt/runs').set(bearer(owner.access)).send({round:79,idempotencyKey:randomUUID(),answerMode:'batch'});const id=c.body.run.id;await start(owner,id);
    // Owned test DB only: receipt increment fails after the bulk answer statement.
    await pool.query('UPDATE hanq.cbt_runs SET checkpoint_version=2147483647 WHERE id=$1',[id]);
    const body={submissionKey:randomUUID(),checkpointVersion:2147483647,answers:rows.map((q,position)=>({position,optionId:q.correct_option_id}))};
    const failed=await api().post(`/api/v1/cbt/runs/${id}/pause`).set(bearer(owner.access)).send(body);assert.ok(failed.status>=500);
    const fresh=await get(owner,id);assert.equal(fresh.body.run.answered,0);assert.equal(fresh.body.run.paused,false);assert.equal(fresh.body.run.pauseSubmissionKey,null);assert.equal((await attemptsOf(id)).length,0);
    await pool.query('UPDATE hanq.cbt_runs SET checkpoint_version=0 WHERE id=$1',[id]);
  });

});
