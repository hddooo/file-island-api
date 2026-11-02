import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, signin, signup, startApp, subId, type TestApp } from '../helpers/app';
import { freshDatabase, sampleQuestions } from '../helpers/db';
import { testConfig } from '../helpers/env';
import { DbService } from '../../src/db/db.service';

describe('free member quiz progress over exact scopes', () => {
  let t: TestApp, pool: Pool;
  const sample=sampleQuestions();const quiz=sample.quiz.filter(q=>q.chapter==='prehistory').sort((a,b)=>a.questionId.localeCompare(b.questionId));const {mock,wrongOf}=sample;
  const pair = (q: typeof quiz[number]) => ({ questionId: q.questionId, version: q.version });
  const scope = quiz.slice(0, 3).map(pair);
  before(async () => { pool = await freshDatabase(testConfig()); t = await startApp(); });
  after(async () => { await t.close(); await pool.end(); });
  const read = (access: string, questions = scope) => request(t.server).post('/api/v1/quiz/progress').set(bearer(access)).send({ questions });
  it('reading/selecting never writes attempts; anonymous cannot read member progress', async () => {
    const s = await signup(t);
    const a = await read(s.access), b = await read(s.access);
    assert.equal(a.status, 200); assert.equal(a.body.answered, 0); assert.deepEqual(a.body, b.body);
    assert.deepEqual(a.body.items.map((x: { questionId: string }) => x.questionId), scope.map(p => p.questionId));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.attempts WHERE user_id=$1', [s.userId])).rows[0].n, 0);
    assert.equal((await request(t.server).post('/api/v1/quiz/progress').send({ questions: scope })).status, 401);
  });
  it('wrong and right saved submissions both count; scope changes and another device retain history', async () => {
    const s = await signup(t);
    for (let i = 0; i < 2; i++) {
      assert.equal((await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...scope[i], optionId: i ? quiz[i].correctOptionId : wrongOf(quiz[i]), submissionId: subId() })).status, 201);
    }
    const a = await read(s.access); assert.equal(a.body.answered, 2);
    assert.deepEqual(a.body.items.map((x: { answered: boolean }) => x.answered), [true, true, false]);
    assert.deepEqual(a.body.items.slice(0, 2).map((x: { correct: boolean }) => x.correct), [false, true]);
    const device = await signin(t, s.email); assert.deepEqual((await read(device.access)).body, a.body);
    assert.equal((await read(s.access, [scope[2], scope[0]])).body.answered, 1);
    const b = await signup(t); assert.equal((await read(b.access)).body.answered, 0);
    assert.equal((await request(t.server).get('/api/v1/wrong-notes').set(bearer(s.access))).status,403);
  });
  it('invalid submissions do not mark solved; duplicate clicks/retries append exactly one immutable attempt', async () => {
    const s = await signup(t), q = quiz[0], submissionId = subId();
    const body = { ...pair(q), submissionId, optionId: mock[0].correctOptionId };
    assert.equal((await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(body)).status, 400);
    assert.equal((await read(s.access)).body.answered, 0);
    body.optionId = wrongOf(q);
    const results = await Promise.all(Array.from({ length: 6 }, () => request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(body)));
    assert.ok(results.every(r => r.status === 201)); assert.equal(new Set(results.map(r => r.body.attempt.id)).size, 1);
    assert.equal((await read(s.access)).body.answered, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.attempts WHERE user_id=$1', [s.userId])).rows[0].n, 1);
  });
  it('a failed database transaction does not produce a completed answer', async () => {
    const s = await signup(t), db = t.app.get(DbService), original = db.tx;
    try {
      db.tx = async () => { throw new Error('isolated injected transaction failure'); };
      assert.equal((await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...scope[0], optionId: wrongOf(quiz[0]), submissionId: subId() })).status, 500);
    } finally { db.tx = original; }
    assert.equal((await read(s.access)).body.answered, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.attempts WHERE user_id=$1', [s.userId])).rows[0].n, 0);
  });

  it('all complete and explicit retry preserve original attempts and wrong-note history', async () => {
    const s = await signup(t);
    for (const q of quiz.slice(0, 3)) await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...pair(q), optionId: wrongOf(q), submissionId: subId() });
    assert.equal((await read(s.access)).body.answered, 3);
    await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...scope[0], optionId: quiz[0].correctOptionId, submissionId: subId() });
    const a = await read(s.access); assert.equal(a.body.answered, 3); assert.equal(a.body.items[0].correct, true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.attempts WHERE user_id=$1', [s.userId])).rows[0].n, 4);
    const notes = await request(t.server).get('/api/v1/wrong-notes?status=all').set(bearer(s.access));
    assert.equal(notes.status,403);
  });
  it('validates exact scope size, duplicate IDs, versions, kind and spoofed owners', async () => {
    const s = await signup(t);
    assert.equal((await read(s.access, [])).status, 400);
    assert.equal((await read(s.access, [scope[0], scope[0]])).status, 400);
    assert.equal((await read(s.access, [{ ...scope[0], version: 'unknown' }])).status, 409);
    assert.equal((await read(s.access, [pair(mock[0])])).status, 409);
    assert.equal((await read(s.access, [{ questionId: 'unknown', version: 'unknown' }])).status, 409);
    assert.equal((await read(s.access, Array.from({ length: 1001 }, () => scope[0]))).status, 400);
    assert.equal((await request(t.server).post('/api/v1/quiz/progress').set(bearer(s.access)).send({ questions: scope, userId: s.userId })).status, 400);
  });
});
