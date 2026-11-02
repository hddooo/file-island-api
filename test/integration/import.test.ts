import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import {buyPremium, bearer, signup, startApp, type TestApp } from '../helpers/app';
import { freshDatabase, sampleQuestions } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('opt-in import of local browser attempts', () => {
  let t: TestApp;
  let pool: Pool;
  const { quiz, mock, wrongOf } = sampleQuestions();
  before(async () => {
    pool = await freshDatabase(testConfig());
    t = await startApp();
  });
  after(async () => {
    await t.close();
    await pool.end();
  });

  const key = () => randomBytes(32).toString('base64url');
  const localId = () => 'a' + randomBytes(8).toString('hex');

  it('re-validates and re-grades every entry on the server; unknown references are reported as skipped', async () => {
    const s = await signup(t);
    const entries = [
      { localId: localId(), mode: 'quiz', questionId: quiz[0].questionId, contentVersion: quiz[0].version, optionId: quiz[0].correctOptionId, ts: Date.parse('2026-09-01T00:00:00Z') },
      { localId: localId(), mode: 'quiz', questionId: quiz[1].questionId, contentVersion: quiz[1].version, optionId: wrongOf(quiz[1]) },
      { localId: localId(), mode: 'mock', questionId: mock[0].questionId, contentVersion: mock[0].version, optionId: wrongOf(mock[0]) },
      { localId: localId(), mode: 'quiz', questionId: quiz[2].questionId, contentVersion: 'old-version', optionId: quiz[2].correctOptionId },
      { localId: localId(), mode: 'quiz', questionId: 'legacy-gone-999', contentVersion: 'x', optionId: 'oabc' },
      { localId: localId(), mode: 'mock', questionId: quiz[3].questionId, contentVersion: quiz[3].version, optionId: quiz[3].correctOptionId },
      { localId: localId(), mode: 'quiz', questionId: quiz[4].questionId, contentVersion: quiz[4].version, optionId: mock[1].correctOptionId },
      { localId: localId(), mode: 'mock', questionId: mock[2].questionId, contentVersion: mock[2].version, optionId: null },
    ];
    const r = await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: key(), entries });
    assert.equal(r.status, 201);
    assert.equal(r.body.imported, 3);
    assert.equal(r.body.grantsPremium, false);
    assert.deepEqual(r.body.skipped.map((x: { reason: string }) => x.reason), ['unknown-question-or-version', 'unknown-question-or-version', 'mode-mismatch', 'unknown-option', 'unanswered-record']);
    const rows = await pool.query<{ question_id: string; correct: boolean; source: string; reported_at: Date | null; created_at: Date }>(`SELECT question_id, correct, source, reported_at, created_at FROM hanq.attempts WHERE user_id = $1 ORDER BY seq`, [s.userId]);
    assert.deepEqual(rows.rows.map((x) => [x.question_id, x.correct, x.source]), [
      [quiz[0].questionId, true, 'import'], [quiz[1].questionId, false, 'import'], [mock[0].questionId, false, 'import'],
    ]);
    assert.equal(rows.rows[0].reported_at!.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(rows.rows[0].created_at.toISOString(), t.clock.now().toISOString(), 'server time, not the client timestamp');
    assert.equal((await request(t.server).get('/api/v1/premium').set(bearer(s.access))).body.active,false,'import does not grant premium');
    await buyPremium(t,s);
    const notes = await request(t.server).get('/api/v1/wrong-notes').set(bearer(s.access));
    assert.equal(notes.body.counts.unresolved, 2);
    const prem = await request(t.server).get('/api/v1/premium').set(bearer(s.access));
    assert.equal(prem.body.active, true);
  });

  it('a client "correct" flag or any extra field is rejected', async () => {
    const s = await signup(t);
    const e = { localId: localId(), mode: 'quiz', questionId: quiz[1].questionId, contentVersion: quiz[1].version, optionId: wrongOf(quiz[1]), correct: true };
    assert.equal((await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: key(), entries: [e] })).status, 400);
  });

  it('importing the same records again is idempotent', async () => {
    const s = await signup(t), k = key();
    const entries = [{ localId: localId(), mode: 'quiz', questionId: quiz[5].questionId, contentVersion: quiz[5].version, optionId: quiz[5].correctOptionId }];
    const a = await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: k, entries });
    const b = await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: k, entries });
    assert.equal(a.body.imported, 1);
    assert.equal(b.body.imported, 0);
    assert.equal(b.body.alreadyImported, 1);
    const n = await pool.query(`SELECT count(*)::int n FROM hanq.attempts WHERE user_id = $1`, [s.userId]);
    assert.equal(n.rows[0].n, 1);
  });

  it('a browser import key belongs to the first account; another account cannot blend it in', async () => {
    const first = await signup(t), second = await signup(t), k = key();
    const entries = [{ localId: localId(), mode: 'quiz', questionId: quiz[6].questionId, contentVersion: quiz[6].version, optionId: quiz[6].correctOptionId }];
    assert.equal((await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(first.access)).send({ importKey: k, entries })).status, 201);
    const r = await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(second.access)).send({ importKey: k, entries });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'import_key_owned_by_another_account');
    const n = await pool.query(`SELECT count(*)::int n FROM hanq.attempts WHERE user_id = $1`, [second.userId]);
    assert.equal(n.rows[0].n, 0);
  });

  it('the per-browser cap counts accepted unique attempts: resends are acknowledged and never charged, no growth points', async () => {
    const s = await signup(t), k = key();
    const old = [{ localId: localId(), mode: 'quiz', questionId: quiz[8].questionId, contentVersion: quiz[8].version, optionId: quiz[8].correctOptionId }];
    const send = (entries: unknown[]) => request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: k, entries });
    assert.equal((await send(old)).body.imported, 1);
    for (let i = 0; i < 3; i++) assert.equal((await send(old)).body.alreadyImported, 1, 'network-failure resend');
    const counters = async () => (await pool.query<{ accepted: number; received: number }>(`SELECT accepted, received FROM hanq.import_batches WHERE user_id = $1`, [s.userId])).rows[0];
    assert.deepEqual(await counters(), { accepted: 1, received: 4 });
    // Move this browser key to one below the cap (admin pool, counters only) and send two new records plus the old one again.
    await pool.query(`UPDATE hanq.import_batches SET accepted = 4999 WHERE user_id = $1`, [s.userId]);
    const fresh = [quiz[9], quiz[10]].map((q) => ({ localId: localId(), mode: 'quiz', questionId: q.questionId, contentVersion: q.version, optionId: q.correctOptionId }));
    const r = await send([old[0], ...fresh]);
    assert.equal(r.status, 201);
    assert.equal(r.body.imported, 1);
    assert.equal(r.body.alreadyImported, 1, 'already-imported records are acknowledged even at the cap');
    assert.deepEqual(r.body.skipped, [{ localId: fresh[1].localId, reason: 'import-cap-reached' }]);
    assert.equal((await counters()).accepted, 5000);
    const again = await send([old[0], fresh[0]]);
    assert.deepEqual([again.body.imported, again.body.alreadyImported, again.body.skippedCount], [0, 2, 0], 'at the cap, retries still succeed');
    const growth = await pool.query(`SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id = $1`, [s.userId]);
    assert.equal(growth.rows[0].n, 1, 'only the signup reward: imports never grant growth points');
  });

  it('automatic account sync: two keys of one owner (concurrent tabs) store one row per localId; another owner is separate', async () => {
    const s1 = await signup(t), s2 = await signup(t), id = localId();
    const e = [{ localId: id, mode: 'quiz', questionId: quiz[11].questionId, contentVersion: quiz[11].version, optionId: wrongOf(quiz[11]) }];
    const send = (s: typeof s1, k: string, body: Record<string, unknown> = { scope: 'account' }) => request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: k, entries: e, ...body });
    const [a, b] = await Promise.all([send(s1, key()), send(s1, key())]);
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.equal(a.body.imported + b.body.imported, 1);
    assert.equal(a.body.alreadyImported + b.body.alreadyImported, 1);
    const rows = await pool.query<{ submission_id: string }>(`SELECT submission_id FROM hanq.attempts WHERE user_id = $1`, [s1.userId]);
    assert.equal(rows.rows.length, 1);
    const list = await request(t.server).get('/api/v1/attempts').set(bearer(s1.access));
    assert.equal(list.body.items[0].submissionId, rows.rows[0].submission_id, 'owner DTO exposes the exact submission id for reconciliation');
    assert.equal((await send(s2, key())).body.imported, 1, 'same localId on another account is its own record');
    assert.equal((await send(s1, key(), { scope: 'other' })).status, 400);
    const growth = await pool.query(`SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id = $1`, [s1.userId]);
    assert.equal(growth.rows[0].n, 1, 'no growth points from sync');
  });

  it('caps entries per request and requires authentication', async () => {
    const s = await signup(t);
    const many = Array.from({ length: 501 }, () => ({ localId: localId(), mode: 'quiz', questionId: quiz[7].questionId, contentVersion: quiz[7].version, optionId: quiz[7].correctOptionId }));
    assert.equal((await request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({ importKey: key(), entries: many })).status, 400);
    assert.equal((await request(t.server).post('/api/v1/imports/local-attempts').send({ importKey: key(), entries: [] })).status, 401);
  });
});
