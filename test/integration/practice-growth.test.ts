import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { buyPremium, bearer, signup, startApp, subId, type Session, type TestApp } from '../helpers/app';
import { freshDatabase, sampleQuestions } from '../helpers/db';
import { testConfig } from '../helpers/env';

/* Ordinary era practice growth (migration 008): POST /api/v1/attempts source 'practice' only — quiz ±1, past-exam mock ±original item points,
   graded from the server's stored answer, one ledger row per recorded attempt, same transaction. Runs on the coordinator's
   isolated *_test database only (helpers refuse anything else). */
describe('ordinary practice growth (quiz ±1, mock original weights)', () => {
  let t: TestApp;
  let pool: Pool;
  const { all, wrongOf } = sampleQuestions();
  const byId = new Map(all.map((q) => [q.questionId, q]));
  let freeQuiz: typeof all = [], freeMock: typeof all = [];
  before(async () => {
    pool = await freshDatabase(testConfig());
    t = await startApp();
    const slots = await pool.query<{ kind: string; question_id: string }>('SELECT kind, question_id FROM hanq.free_question_slots ORDER BY chapter, kind, position');
    freeQuiz = slots.rows.filter((r) => r.kind === 'quiz').map((r) => byId.get(r.question_id)!).filter(Boolean);
    freeMock = slots.rows.filter((r) => r.kind === 'mock').map((r) => byId.get(r.question_id)!).filter(Boolean);
  });
  after(async () => {
    await t.close();
    await pool.end();
  });

  const submit = (s: Session, q: (typeof all)[number], optionId: string, submissionId = subId()) =>
    request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId, questionId: q.questionId, version: q.version, optionId });
  const ledger = async (userId: string) => (await pool.query<{ kind: string; amount: number; attempt_id: string | null }>(
    `SELECT kind, amount, attempt_id FROM hanq.growth_ledger WHERE user_id = $1 AND kind LIKE 'practice-%' ORDER BY created_at, event_key`, [userId])).rows;
  const weight = (q: (typeof all)[number]) => { assert.ok(Number.isInteger(q.points) && q.points >= 1 && q.points <= 3, 'fixture must state the original mock weight'); return q.points; };
  const points = async (s: Session) => (await request(t.server).get('/api/v1/me').set(bearer(s.access))).body.growth.points as number;

  it('free member: quiz ±1 and original mock weights, server-graded, authoritative total in the response', async () => {
    const s = await signup(t);
    assert.ok(freeQuiz.length >= 2 && freeMock.length >= 2, 'fixed free slots are seeded');
    const correctWeight = weight(freeMock[0]), wrongWeight = weight(freeMock[1]), expectedTotal = 1010 + correctWeight - wrongWeight;
    const r1 = await submit(s, freeQuiz[0], freeQuiz[0].correctOptionId);
    assert.equal(r1.status, 201);
    assert.deepEqual(r1.body.growth, { delta: 1, points: 1011 });
    const r2 = await submit(s, freeQuiz[1], wrongOf(freeQuiz[1]));
    assert.deepEqual(r2.body.growth, { delta: -1, points: 1010 });
    const r3 = await submit(s, freeMock[0], freeMock[0].correctOptionId);
    assert.equal(r3.status, 201);
    assert.deepEqual(r3.body.growth, { delta: correctWeight, points: 1010 + correctWeight });
    const r4 = await submit(s, freeMock[1], wrongOf(freeMock[1]));
    assert.equal(r4.status, 201);
    assert.deepEqual(r4.body.growth, { delta: -wrongWeight, points: expectedTotal });
    assert.equal(await points(s), expectedTotal);
    const rows = await ledger(s.userId);
    const byAttempt = new Map(rows.map((x) => [x.attempt_id, [x.kind, x.amount]]));
    assert.equal(rows.length, 4, 'one row per recorded attempt');
    assert.deepEqual([r1, r2, r3, r4].map((r) => byAttempt.get(r.body.attempt.id)),
      [['practice-quiz', 1], ['practice-quiz', -1], ['practice-mock', correctWeight], ['practice-mock', -wrongWeight]]);
    const hist = await request(t.server).get('/api/v1/me/growth-history?limit=50').set(bearer(s.access));
    assert.deepEqual(hist.body.items.filter((x: { reason: string }) => x.reason.startsWith('practice-')).map((x: { reason: string; points: number }) => [x.reason, x.points]).sort(),
      [['practice-mock', -wrongWeight], ['practice-mock', correctWeight], ['practice-quiz', -1], ['practice-quiz', 1]].sort());
  });

  it('same submission again: original result and delta, never a second ledger effect; a different answer under it is rejected', async () => {
    const s = await signup(t), q = freeQuiz[2], sid = subId();
    const a = await submit(s, q, wrongOf(q), sid);
    const b = await submit(s, q, wrongOf(q), sid);
    assert.equal(b.status, 201);
    assert.equal(b.body.replayed, true);
    assert.equal(b.body.attempt.id, a.body.attempt.id);
    assert.deepEqual(b.body.growth, { delta: -1, points: 1009 });
    const c = await submit(s, q, q.correctOptionId, sid);
    assert.equal(c.status, 409);
    assert.equal(c.body.error.code, 'submission_conflict');
    assert.equal((await ledger(s.userId)).length, 1);
    assert.equal(await points(s), 1009);
  });

  it('a new legitimate try (new submissionId) of the same question is graded and rewarded again — no per-question dedup', async () => {
    const s = await signup(t), q = freeQuiz[3];
    await submit(s, q, wrongOf(q));
    const second = await submit(s, q, q.correctOptionId);
    assert.deepEqual(second.body.growth, { delta: 1, points: 1010 });
    assert.equal((await ledger(s.userId)).length, 2);
  });

  it('concurrent requests with one submission id: one attempt, one ledger row (database constraints)', async () => {
    const s = await signup(t), q = freeMock[2], sid = subId(), expectedWeight = weight(q), expectedTotal = 1010 + expectedWeight;
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => submit(s, q, q.correctOptionId, sid)));
    assert.ok(rs.every((r) => r.status === 201));
    assert.equal(new Set(rs.map((r) => r.body.attempt.id)).size, 1);
    assert.equal(rs.filter(r => !r.body.replayed).length, 1, 'only one original submission');
    assert.ok(rs.every((r) => r.body.growth.delta === expectedWeight && r.body.growth.points === expectedTotal));
    const attemptId = rs[0].body.attempt.id;
    assert.deepEqual(await ledger(s.userId), [{ kind:'practice-mock', amount:expectedWeight, attempt_id:attemptId }]);
    assert.equal(await points(s), expectedTotal);
    const attemptRows = async () => (await pool.query('SELECT row_to_json(a) AS value FROM hanq.attempts a WHERE user_id=$1', [s.userId])).rows;
    const ledgerRows = async () => (await pool.query('SELECT event_key,kind,amount,attempt_id,created_at::text FROM hanq.growth_ledger WHERE user_id=$1 ORDER BY event_key', [s.userId])).rows;
    const beforeAttempts = await attemptRows(), beforeLedger = await ledgerRows();
    assert.equal(beforeAttempts.length, 1);
    assert.equal(beforeLedger.filter(r => r.kind==='signup' && r.amount===1000).length, 1);
    assert.equal(beforeLedger.filter(r => r.kind==='attendance' && r.amount===10).length, 1);
    assert.equal(beforeLedger.filter(r => r.event_key==='practice:'+attemptId && r.amount===expectedWeight).length, 1);
    assert.equal(beforeLedger.length, 3, 'signup, attendance, exactly one practice reward');
    for(let retry=0;retry<3;retry++){
      const replay = await submit(s,q,q.correctOptionId,sid);
      assert.equal(replay.status,201); assert.equal(replay.body.replayed,true); assert.equal(replay.body.attempt.id,attemptId);
      assert.deepEqual(replay.body.growth,{delta:expectedWeight,points:expectedTotal});
    }
    assert.equal((await submit(s,q,wrongOf(q),sid)).status,409);
    assert.deepEqual(await attemptRows(),beforeAttempts,'retries/conflict never alter the attempt');
    assert.deepEqual(await ledgerRows(),beforeLedger,'retries/conflict never append or rewrite XP');
    assert.equal(await points(s),expectedTotal);
  });

  it('client cannot claim correctness or points; outside the free five nothing is graded or rewarded; premium practises anything', async () => {
    const s = await signup(t), q = freeQuiz[4];
    const forged = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: wrongOf(q), correct: true, points: 100 });
    assert.equal(forged.status, 400);
    const free = new Set([...freeQuiz, ...freeMock].map((x) => x.questionId));
    const outside = all.find((x) => x.kind === 'quiz' && !free.has(x.questionId))!;
    const denied = await submit(s, outside, outside.correctOptionId);
    assert.equal(denied.status, 403);
    assert.equal((await ledger(s.userId)).length, 0);
    assert.equal(await points(s), 1010);
    await buyPremium(t, s);
    const ok = await submit(s, outside, outside.correctOptionId);
    assert.deepEqual(ok.body.growth, { delta: 1, points: 1011 }, 'premium members earn the same ordinary practice growth');
  });

  it('imports, wrong-note replays and existing history get no ordinary practice rewards (no backfill)', async () => {
    const s = await signup(t), q = freeQuiz[0];
    const imp = await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access))
      .send({ importKey: 'k'.repeat(43), scope: 'account', entries: [{ localId: 'a0000000aa', mode: 'quiz', questionId: q.questionId, contentVersion: q.version, optionId: q.correctOptionId }] });
    assert.equal(imp.body.imported, 1);
    assert.equal((await ledger(s.userId)).length, 0);
    const unrewarded = await pool.query(`SELECT count(*)::int n FROM hanq.attempts a WHERE a.source <> 'practice' AND EXISTS (SELECT 1 FROM hanq.growth_ledger g WHERE g.attempt_id = a.id)`);
    assert.equal(unrewarded.rows[0].n, 0, 'only practice attempts ever carry a practice reward');
  });

  it('the database itself refuses practice rows that break the 008 rules', async () => {
    const s = await signup(t), r = await submit(s, freeQuiz[1], freeQuiz[1].correctOptionId), id = r.body.attempt.id;
    for (const [kind, amount, key] of [['practice-quiz', 5, 'practice:x'], ['practice-mock', 1, 'practice:x'], ['practice-quiz', 1, 'other-key']] as const)
      await assert.rejects(pool.query(`INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, attempt_id, created_at) VALUES ($1, $2, $3, $4, $5, now())`, [s.userId, key === 'practice:x' ? 'practice:' + id + 'x' : key, kind, amount, id]));
    await assert.rejects(pool.query(`INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, attempt_id, created_at) VALUES ($1, $2, 'practice-quiz', 1, $3, now())`, [s.userId, 'practice:' + id, id]), 'second reward for one attempt');
    await assert.rejects(pool.query(`UPDATE hanq.growth_ledger SET amount = 1 WHERE attempt_id = $1`, [id]), /append-only/);
  });

  it('with 008 missing, a practice grade rolls back completely (no attempt, no fake reward) and reports schema_not_ready', async () => {
    const s = await signup(t), q = freeQuiz[2];
    await pool.query('ALTER TABLE hanq.growth_ledger DROP COLUMN attempt_id CASCADE'); // simulates an API deployed ahead of 008 (isolated test DB only)
    const r = await submit(s, q, q.correctOptionId);
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'schema_not_ready');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id = $1', [s.userId])).rows[0].n, 0, 'attempt rolled back');
    assert.equal(await points(s), 1010);
  });
});
