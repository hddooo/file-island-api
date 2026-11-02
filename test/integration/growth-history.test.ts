import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, signup, startApp, type Session, type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

/* GET /api/v1/me/growth-history over the existing append-only ledger (migration 003): no new migration, grant or backfill.
   Extra ledger rows are written with the admin pool exactly as the server writes them (one run per study reward). */
describe('growth history (read-only, owner-only, keyset pagination)', () => {
  let t: TestApp;
  let pool: Pool;
  before(async () => {
    pool = await freshDatabase(testConfig());
    t = await startApp();
  });
  after(async () => {
    await t.close();
    await pool.end();
  });

  let runSeq = 100;
  async function studyReward(s: Session, amount: number, at: string): Promise<string> {
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO hanq.runs (id, user_id, seq, product, size, duration_ms, status, selection, created_at) VALUES ($1, $2, $3, 'personal-mini', 20, 60000, 'ready', '{}'::jsonb, $4)`,
      [runId, s.userId, ++runSeq, at],
    );
    await pool.query(`INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, run_id, created_at) VALUES ($1, $2, 'wrong-note-study', $3, $4, $5)`, [s.userId, 'study:' + runId, amount, runId, at]);
    return runId;
  }
  const page = (s: Session, query = '') => request(t.server).get('/api/v1/me/growth-history' + query).set(bearer(s.access));

  it('requires authentication and returns only the caller’s own rows, newest first, with signed points', async () => {
    assert.equal((await request(t.server).get('/api/v1/me/growth-history')).status, 401);
    const a = await signup(t), b = await signup(t);
    await studyReward(a, -100, '2026-10-08T04:00:00.000Z');
    await studyReward(a, 150, '2026-10-08T05:00:00.000Z');
    await studyReward(b, 200, '2026-10-08T06:00:00.000Z');
    const r = await page(a);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((x: { reason: string; points: number }) => [x.reason, x.points]), [['wrong-note-study', 150], ['wrong-note-study', -100], ['signup', 1000], ['attendance', 10]]);
    assert.equal(r.body.items[0].createdAt, '2026-10-08T05:00:00.000Z');
    assert.equal(r.body.next, null);
    assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['createdAt', 'examResult', 'points', 'reason'], 'no ledger keys, run ids or user ids in the DTO');
    assert.equal(r.body.items[0].examResult, null, 'the run was never finalized: no exam result');
    assert.deepEqual(Object.keys(r.body.items[2]).sort(), ['createdAt', 'points', 'reason'], 'signup has no exam result');
    const me = await request(t.server).get('/api/v1/me').set(bearer(a.access));
    assert.equal(me.body.growth.points, r.body.items.reduce((n: number, x: { points: number }) => n + x.points, 0), 'history sums to the profile score');
    const other = await page(b);
    assert.deepEqual(other.body.items.map((x: { points: number }) => x.points), [200, 1000, 10]);
  });

  it('pages through equal and microsecond-apart timestamps without skipping or repeating a row', async () => {
    const s = await signup(t);
    const tie = '2026-10-08T07:00:00.123456Z';
    const keys = [await studyReward(s, 50, tie), await studyReward(s, 100, tie), await studyReward(s, 200, tie)];
    await studyReward(s, 150, '2026-10-08T07:00:00.123457Z'); // 1µs later: must come first even though JS dates see the same millisecond
    await studyReward(s, -100, '2026-10-08T07:00:00.123455Z'); // 1µs earlier
    const seen: number[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const r = await page(s, '?limit=2' + (cursor ? '&cursor=' + cursor : ''));
      assert.equal(r.status, 200);
      assert.ok(r.body.items.length <= 2);
      seen.push(...r.body.items.map((x: { points: number }) => x.points));
      cursor = r.body.next;
      pages++;
    } while (cursor && pages < 10);
    assert.equal(seen.length, 7, 'every row exactly once');
    assert.equal(seen[0], 150);
    assert.deepEqual(seen.slice(1, 4).sort((x, y) => x - y), [50, 100, 200], 'the three tied rows, each once');
    assert.deepEqual(seen.slice(4), [-100, 1000, 10]);
    // Stable tie order: the same request twice gives the same sequence.
    const again = await page(s, '?limit=50');
    assert.deepEqual(again.body.items.map((x: { points: number }) => x.points), seen);
    assert.equal(keys.length, 3);
  });

  it('a cursor from another user only continues the caller’s own history', async () => {
    const a = await signup(t), b = await signup(t);
    await studyReward(a, 50, '2026-10-08T08:00:00.000Z');
    await studyReward(a, 100, '2026-10-08T09:00:00.000Z');
    await studyReward(b, 200, '2026-10-08T10:00:00.000Z');
    const firstA = await page(a, '?limit=1');
    assert.ok(firstA.body.next);
    const r = await page(b, '?limit=50&cursor=' + firstA.body.next);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every((x: { points: number }) => x.points !== 50 && x.points !== 100), 'never another user’s rows');
  });

  it('rejects malformed cursors and out-of-range limits; never writes', async () => {
    const s = await signup(t);
    const before = (await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger')).rows[0].n;
    for (const q of ['?cursor=%24%24', '?cursor=' + Buffer.from('2026-10-08T03:00:00.123Z|signup').toString('base64url'), '?limit=0', '?limit=51', '?limit=abc', '?other=1']) {
      const r = await page(s, q);
      assert.equal(r.status, 400, q);
    }
    assert.equal((await page(s, '?cursor=' + Buffer.from('2026-10-08T03:00:00.123Z|signup').toString('base64url'))).body.error.code, 'invalid_cursor');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger')).rows[0].n, before);
  });
  /* ---------- final exam result next to a challenge / CBT reward (read-only joins; no migration) ---------- */
  function storedStudyScore(correct: number, questions: number, extra: Record<string, unknown> = {}) {
    const examScore = Math.round((correct * 100) / questions);
    const reward = examScore < 60 ? -100 : examScore < 70 ? 50 : examScore < 80 ? 100 : examScore < 90 ? 150 : 200;
    return { questions, correct, wrong: questions - correct, answered: questions, unanswered: 0, examScore, growthReward: reward, rewardEligible: true, ...extra };
  }
  async function finalStudy(owner: Session, ledgerUser: Session, amount: number, at: string, score: unknown, status: 'final' | 'active' = 'final'): Promise<string> {
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO hanq.runs (id, user_id, seq, product, size, duration_ms, status, selection, created_at, started_at, ends_at, final_at, final_reason, score)
       VALUES ($1, $2, $3, 'personal-mini', 20, 1800000, $4, '{"mode":"wrong-note-study","challenge":true}'::jsonb, $5, $5, $5::timestamptz + interval '30 minutes',
               CASE WHEN $4 = 'final' THEN $5::timestamptz + interval '10 minutes' END, CASE WHEN $4 = 'final' THEN 'submit' END, $6::jsonb)`,
      [runId, owner.userId, ++runSeq, status, at, score === undefined ? null : JSON.stringify(score)],
    );
    await pool.query(`INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, run_id, created_at) VALUES ($1, $2, 'wrong-note-study', $3, $4, $5)`, [ledgerUser.userId, 'study:' + runId, amount, runId, at]);
    return runId;
  }
  async function cbtRun(s: Session, amount: number, at: string, result: Record<string, unknown> | null, status: 'final' | 'active' = 'final'): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO hanq.cbt_runs (id, user_id, idempotency_key, exam_round, status, duration_ms, created_at, updated_at, started_at, ends_at, final_at, final_reason, result)
       VALUES ($1, $2, $3, 75, $4, 4800000, $5, $5, $5, $5::timestamptz + interval '80 minutes',
               CASE WHEN $4 = 'final' THEN $5::timestamptz + interval '50 minutes' END, CASE WHEN $4 = 'final' THEN 'submit' END, $6::jsonb)`,
      [id, s.userId, 'cbt-test-' + id, status, at, result === null ? null : JSON.stringify(result)],
    );
    await pool.query(`INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, cbt_run_id, created_at) VALUES ($1, 'cbt:' || $2::uuid::text, 'cbt-exam', $3, $2::uuid, $4)`, [s.userId, id, amount, at]);
    return id;
  }
  const cbtStored = (score: number, correct: number, reward: number) => ({ round: 75, total: 50, maxScore: 100, score, correct, wrong: 50 - correct, unanswered: 0, answered: 50, grade: null, passed: false, growthReward: reward, reason: 'submit' });

  it('shows the stored final score/correct/total next to each challenge reward or deduction (45/100 · 9/20 → -100)', async () => {
    const s = await signup(t);
    await finalStudy(s, s, -100, '2026-10-09T01:00:00.000Z', storedStudyScore(9, 20));
    await finalStudy(s, s, 200, '2026-10-09T02:00:00.000Z', storedStudyScore(19, 20));
    await finalStudy(s, s, -100, '2026-10-09T03:00:00.000Z', storedStudyScore(0, 20));
    const r = await page(s);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((x: { points: number; examResult?: unknown }) => [x.points, x.examResult]), [
      [-100, { score: 0, maxScore: 100, correct: 0, total: 20 }],
      [200, { score: 95, maxScore: 100, correct: 19, total: 20 }],
      [-100, { score: 45, maxScore: 100, correct: 9, total: 20 }],
      [1000, undefined],
      [10, undefined],
    ]);
    const text = JSON.stringify(r.body);
    assert.ok(!/run_?id|user_?id|answer|selection/i.test(text), 'no run ids, user ids or answers in the DTO');
  });

  it('legacy, unfinished or malformed stored results are null (never a guessed score); foreign runs never disclose', async () => {
    const a = await signup(t), b = await signup(t);
    await finalStudy(a, a, -100, '2026-10-09T04:00:00.000Z', { questions: 20, correct: 9, wrong: 11 }); // stored before examScore existed
    await finalStudy(a, a, 50, '2026-10-09T05:00:00.000Z', storedStudyScore(13, 20), 'active'); // not final
    await finalStudy(a, a, -100, '2026-10-09T06:00:00.000Z', storedStudyScore(9, 20, { examScore: 46 })); // inconsistent
    await finalStudy(a, a, 150, '2026-10-09T07:00:00.000Z', storedStudyScore(9, 20)); // stored reward ≠ ledger amount
    await finalStudy(b, a, 200, '2026-10-09T08:00:00.000Z', storedStudyScore(19, 20)); // a's ledger row pointing at b's run
    const r = await page(a);
    const rows = r.body.items.filter((x: { reason: string }) => x.reason === 'wrong-note-study');
    assert.equal(rows.length, 5);
    assert.ok(rows.every((x: { examResult: unknown }) => x.examResult === null), JSON.stringify(rows));
    assert.ok(!JSON.stringify(r.body).includes('"score":95'), 'b’s result is never shown to a');
  });

  it('CBT final result: stored weighted score and correct/total; unfinished CBT run is not shown', async () => {
    const s = await signup(t);
    await cbtRun(s, 150, '2026-10-09T09:00:00.000Z', cbtStored(82, 41, 150));
    await cbtRun(s, -100, '2026-10-09T10:00:00.000Z', null, 'active');
    await cbtRun(s, 200, '2026-10-09T11:00:00.000Z', cbtStored(82, 41, 150)); // reward disagrees with ledger
    const r = await page(s);
    const cbt = r.body.items.filter((x: { reason: string }) => x.reason === 'cbt-exam');
    assert.deepEqual(cbt.map((x: { points: number; examResult: unknown }) => [x.points, x.examResult]), [[200, null], [-100, null], [150, { score: 82, maxScore: 100, correct: 41, total: 50 }]]);
  });

  it('exam results do not change paging: limit=1 pages and repeated requests give the same rows and results', async () => {
    const s = await signup(t);
    const tie = '2026-10-09T12:00:00.654321Z';
    await finalStudy(s, s, -100, tie, storedStudyScore(9, 20));
    await finalStudy(s, s, 100, tie, storedStudyScore(15, 20));
    await cbtRun(s, 50, '2026-10-09T12:00:00.654322Z', cbtStored(64, 32, 50));
    const full = (await page(s, '?limit=50')).body.items;
    const seen: unknown[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const r = await page(s, '?limit=1' + (cursor ? '&cursor=' + cursor : ''));
      seen.push(...r.body.items);
      cursor = r.body.next;
      pages++;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, full, 'every row once, same exam results');
    assert.deepEqual((await page(s, '?limit=50')).body.items, full, 'repeatable');
    assert.equal(full.length, 5, 'three result events plus signup and first attendance');
    const ofKind = (reason:string) => full.filter((x:{reason:string})=>x.reason===reason).map((x:{points:number})=>x.points).sort((a:number,b:number)=>a-b);
    assert.deepEqual(ofKind('signup'),[1000]);
    assert.deepEqual(ofKind('attendance'),[10]);
    assert.deepEqual(ofKind('wrong-note-study'),[-100,100]);
    assert.deepEqual(ofKind('cbt-exam'),[50]);
    const attendanceRows = await pool.query("SELECT event_key,amount,attendance_day::text FROM hanq.growth_ledger WHERE user_id=$1 AND kind='attendance'", [s.userId]);
    assert.deepEqual(attendanceRows.rows,[{event_key:'attendance:2026-10-08',amount:10,attendance_day:'2026-10-08'}]);
    assert.equal(full.reduce((sum:number,x:{points:number})=>sum+x.points,0),1060);
    assert.deepEqual(full[0].examResult, { score: 64, maxScore: 100, correct: 32, total: 50 });
  });
});
