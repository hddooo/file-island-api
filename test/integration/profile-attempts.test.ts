import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { buyPremium, bearer, csrf, PASSWORD, signup, startApp, subId, type TestApp } from '../helpers/app';
import { freshDatabase, sampleQuestions } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('profile (me only) and attempts (server grading, idempotence, ownership)', () => {
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

  it('GET /me returns safe fields only; PATCH /me accepts displayName only', async () => {
    const s = await signup(t);
    const me = await request(t.server).get('/api/v1/me').set(bearer(s.access));
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys(me.body.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
    assert.equal(me.body.premium.active, false);
    assert.equal((await request(t.server).patch('/api/v1/me').set(bearer(s.access)).send({displayName:'free edit'})).status,403);
    await buyPremium(t,s);
    const p = await request(t.server).patch('/api/v1/me').set(bearer(s.access)).send({ displayName: '  새 이름 ' });
    assert.equal(p.status, 200);
    assert.equal(p.body.user.displayName, '새 이름');
    for (const body of [{ displayName: 'x', email: 'evil@example.test' }, { displayName: 'x', id: randomUUID() }, { displayName: '<b>' }, {}]) {
      assert.equal((await request(t.server).patch('/api/v1/me').set(bearer(s.access)).send(body)).status, 400, JSON.stringify(body));
    }
    const again = await request(t.server).get('/api/v1/me').set(bearer(s.access));
    assert.equal(again.body.user.email, s.email);
  });

  it('password change requires the current password and revokes other sessions only', async () => {
    const s = await signup(t);
    const other = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD });
    const wrong = await request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: 'not-it-123456', newPassword: 'another strong 9876' });
    assert.equal(wrong.status, 403);
    const ok = await request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: PASSWORD, newPassword: 'another strong 9876' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.revokedOtherSessions, 1);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 200);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(other.body.accessToken))).status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD })).status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: 'another strong 9876' })).status, 200);
  });

  it('public question endpoints never include answers or reviews', async () => {
    const q = await request(t.server).get(`/api/v1/questions/${quiz[0].questionId}`);
    assert.equal(q.status, 200);
    const text = JSON.stringify(q.body);
    for (const k of ['"correct"', '"answer"', '"review"', '"overview"', '"why"', '"cue"', '"compound"', '"sources"', '"legacy"']) assert.ok(!text.includes(k), k);
    assert.equal(q.body.version, quiz[0].version);
    const list = await request(t.server).get('/api/v1/questions?kind=mock&limit=5');
    assert.equal(list.body.items.length, 5);
    assert.ok(list.body.next);
    assert.ok(!JSON.stringify(list.body).includes('"correct"'));
    const page2 = await request(t.server).get(`/api/v1/questions?kind=mock&limit=5&after=${list.body.next}`);
    assert.notEqual(page2.body.items[0].questionId, list.body.items[0].questionId);
    assert.equal((await request(t.server).get('/api/v1/questions/no-such-question')).status, 404);
  });

  it('grades on the server; a client "correct" flag is rejected outright', async () => {
    const s = await signup(t);
    await buyPremium(t,s);
    const q = quiz[1];
    const right = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: q.correctOptionId });
    assert.equal(right.status, 201);
    assert.equal(right.body.attempt.correct, true);
    assert.equal(right.body.review.correctOptionId, q.correctOptionId);
    const wrong = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: wrongOf(q) });
    assert.equal(wrong.body.attempt.correct, false);
    const tampered = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: wrongOf(q), correct: true });
    assert.equal(tampered.status, 400);
    const userIdInBody = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: q.correctOptionId, userId: randomUUID() });
    assert.equal(userIdInBody.status, 400);
  });

  it('validates question, version and option', async () => {
    const s = await signup(t);
    await buyPremium(t,s);
    const q = mock[0];
    const send = (b: object) => request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), ...b });
    assert.equal((await send({ questionId: 'exam-99-99', version: q.version, optionId: 'exam-99-99-option-1' })).status, 404);
    assert.equal((await send({ questionId: q.questionId, version: 'not-a-version', optionId: q.correctOptionId })).status, 404);
    const foreignOpt = await send({ questionId: q.questionId, version: q.version, optionId: mock[1].correctOptionId });
    assert.equal(foreignOpt.status, 400);
    assert.equal(foreignOpt.body.error.code, 'invalid_option');
    assert.equal((await send({ questionId: q.questionId, version: q.version })).status, 400);
    assert.equal((await request(t.server).post('/api/v1/attempts').send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: q.correctOptionId })).status, 401);
  });

  it('submissionId is idempotent per user; a different payload under the same id is rejected', async () => {
    const s = await signup(t);
    await buyPremium(t,s);
    const q = quiz[2], id = subId('idem');
    const body = { submissionId: id, questionId: q.questionId, version: q.version, optionId: q.correctOptionId };
    const a = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(body);
    const b = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(body);
    assert.equal(a.body.attempt.id, b.body.attempt.id);
    assert.equal(b.body.replayed, true);
    const c = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...body, optionId: wrongOf(q) });
    assert.equal(c.status, 409);
    assert.equal(c.body.error.code, 'submission_conflict');
    // the same id is independent for another user
    const other = await signup(t);await buyPremium(t,other);
    const d = await request(t.server).post('/api/v1/attempts').set(bearer(other.access)).send(body);
    assert.equal(d.status, 201);
    assert.notEqual(d.body.attempt.id, a.body.attempt.id);
    // concurrent duplicates create exactly one row
    const id2 = subId('race');
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ ...body, submissionId: id2 })));
    assert.equal(new Set(rs.map((r) => r.body.attempt.id)).size, 1);
    const n = await pool.query(`SELECT count(*)::int n FROM hanq.attempts WHERE submission_id = $1`, [id2]);
    assert.equal(n.rows[0].n, 1);
  });

  it('history is paginated, newest first, and only ever shows the caller\'s own attempts', async () => {
    const s = await signup(t), other = await signup(t);await buyPremium(t,s);await buyPremium(t,other);
    for (let i = 0; i < 5; i++) {
      const q = quiz[10 + i];
      await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: q.correctOptionId });
    }
    const foreign = await request(t.server).post('/api/v1/attempts').set(bearer(other.access)).send({ submissionId: subId(), questionId: quiz[20].questionId, version: quiz[20].version, optionId: quiz[20].correctOptionId });
    const p1 = await request(t.server).get('/api/v1/attempts?limit=2').set(bearer(s.access));
    assert.equal(p1.body.items.length, 2);
    assert.equal(p1.body.items[0].questionId, quiz[14].questionId);
    const p2 = await request(t.server).get(`/api/v1/attempts?limit=2&cursor=${p1.body.next}`).set(bearer(s.access));
    const p3 = await request(t.server).get(`/api/v1/attempts?limit=2&cursor=${p2.body.next}`).set(bearer(s.access));
    assert.equal(p3.body.items.length, 1);
    assert.equal(p3.body.next, null);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((x: { questionId: string }) => x.questionId);
    assert.equal(new Set(all).size, 5);
    assert.ok(!all.includes(quiz[20].questionId));
    assert.equal((await request(t.server).get('/api/v1/attempts?cursor=%27%3B--').set(bearer(s.access))).status, 400);
    // detail: own → 200 with review; someone else's id → 404 (same as missing)
    const own = await request(t.server).get(`/api/v1/attempts/${p1.body.items[0].id}`).set(bearer(s.access));
    assert.equal(own.status, 200);
    assert.ok(own.body.review.correctOptionId);
    assert.equal((await request(t.server).get(`/api/v1/attempts/${foreign.body.attempt.id}`).set(bearer(s.access))).status, 404);
    assert.equal((await request(t.server).get(`/api/v1/attempts/${randomUUID()}`).set(bearer(s.access))).status, 404);
    assert.equal((await request(t.server).get('/api/v1/attempts/not-a-uuid').set(bearer(s.access))).status, 404);
  });
});
