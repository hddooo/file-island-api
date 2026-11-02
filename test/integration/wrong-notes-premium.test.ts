import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, buyPremium, signin, signup, startApp, subId, type Session, type TestApp } from '../helpers/app';
import { freshDatabase, sampleQuestions } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('wrong notes (derived), premium replay and server runs', () => {
  let t: TestApp;
  let pool: Pool;
  const { quiz, mock, wrongOf } = sampleQuestions();
  const byId = new Map([...quiz, ...mock].map((q) => [q.questionId, q]));
  before(async () => {
    pool = await freshDatabase(testConfig());
    t = await startApp();
  });
  after(async () => {
    await t.close();
    await pool.end();
  });

  const answer = (s: Session, q: { questionId: string; version: string }, optionId: string) =>
    request(t.server).post('/api/v1/imports/local-attempts').set(bearer(s.access)).send({importKey:s.userId.replace(/-/g,''),entries:[{localId:'a'+subId().replace(/[^a-z0-9]/g,''),mode:byId.get(q.questionId)!.kind,questionId:q.questionId,contentVersion:q.version,optionId}]});
  async function wrongMany(s: Session, n: number, offset = 100) {
    for (let i = 0; i < n; i++) await answer(s, quiz[offset + i], wrongOf(quiz[offset + i]));
  }

  it('wrong notes are derived from the caller\'s own attempts: wrong → unresolved, later correct → resolved', async () => {
    const s = await signup(t), other = await signup(t);await buyPremium(t,s);
    const q1 = quiz[30], q2 = mock[3];
    await answer(s, q1, wrongOf(q1));
    await answer(s, q2, wrongOf(q2));
    await answer(other, quiz[31], wrongOf(quiz[31]));
    let r = await request(t.server).get('/api/v1/wrong-notes').set(bearer(s.access));
    assert.deepEqual(r.body.counts, { unresolved: 2, resolved: 0, everWrong: 2, stale: 0 });
    assert.deepEqual(r.body.items.map((x: { questionId: string }) => x.questionId).sort(), [q1.questionId, q2.questionId].sort());
    assert.ok(!JSON.stringify(r.body).includes('"correct":true'));
    await answer(s, q1, q1.correctOptionId);
    r = await request(t.server).get('/api/v1/wrong-notes?status=all').set(bearer(s.access));
    assert.deepEqual(r.body.counts, { unresolved: 1, resolved: 1, everWrong: 2, stale: 0 });
    assert.equal(r.body.items.find((x: { questionId: string }) => x.questionId === q1.questionId).status, 'resolved');
    const mockOnly = await request(t.server).get('/api/v1/wrong-notes?kind=mock').set(bearer(s.access));
    assert.deepEqual(mockOnly.body.items.map((x: { questionId: string }) => x.questionId), [q2.questionId]);
  });

  it('free accounts are refused replays and runs by the server (403 premium_required)', async () => {
    const s = await signup(t);
    await wrongMany(s, 12);
    const rp = await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({ list: 'unresolved', order: 'recent' });
    assert.equal(rp.status, 403);
    assert.equal(rp.body.error.code, 'premium_required');
    const run = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'unresolved', order: 'recent' });
    assert.equal(run.status, 403);
    // a "premium" claim in the body is not even accepted
    assert.equal((await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({ list: 'unresolved', order: 'recent', premium: true })).status, 400);
  });

  it('premium replay: finite server queue, server grading, idempotent answers, owner-only', async () => {
    const s = await signup(t);
    await wrongMany(s, 3, 200);
    assert.equal((await buyPremium(t, s)).status, 200);
    const created = await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({ list: 'unresolved', order: 'random', size: 2 });
    assert.equal(created.status, 201);
    assert.equal(created.body.items.length, 2);
    assert.ok(created.body.items.every((i: { result: unknown }) => i.result === null));
    assert.ok(!JSON.stringify(created.body.items).includes('"correct"'));
    const id = created.body.replay.id, first = created.body.items[0];
    const q = byId.get(first.questionId)!;
    assert.deepEqual([...first.optionOrder].sort(), [...q.optionIds].sort());
    const sid = subId('rp');
    const a1 = await request(t.server).post(`/api/v1/wrong-notes/replays/${id}/answers`).set(bearer(s.access)).send({ submissionId: sid, position: 0, optionId: q.correctOptionId });
    assert.equal(a1.status, 200);
    assert.equal(a1.body.attempt.correct, true);
    assert.equal(a1.body.attempt.source, 'wrong-replay');
    const again = await request(t.server).post(`/api/v1/wrong-notes/replays/${id}/answers`).set(bearer(s.access)).send({ submissionId: sid, position: 0, optionId: q.correctOptionId });
    assert.equal(again.body.replayed, true);
    const twice = await request(t.server).post(`/api/v1/wrong-notes/replays/${id}/answers`).set(bearer(s.access)).send({ submissionId: subId('rp'), position: 0, optionId: q.correctOptionId });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'already_answered');
    assert.equal((await request(t.server).post(`/api/v1/wrong-notes/replays/${id}/answers`).set(bearer(s.access)).send({ submissionId: subId(), position: 7, optionId: q.correctOptionId })).status, 404);
    const view = await request(t.server).get(`/api/v1/wrong-notes/replays/${id}`).set(bearer(s.access));
    assert.equal(view.body.items[0].result.correct, true);
    assert.equal(view.body.items[1].result, null);
    // the replayed question is now resolved
    const notes = await request(t.server).get('/api/v1/wrong-notes').set(bearer(s.access));
    assert.equal(notes.body.counts.unresolved, 2);
    // someone else (even premium) cannot see or answer it
    const other = await signup(t);
    await buyPremium(t, other);
    assert.equal((await request(t.server).get(`/api/v1/wrong-notes/replays/${id}`).set(bearer(other.access))).status, 404);
    assert.equal((await request(t.server).post(`/api/v1/wrong-notes/replays/${id}/answers`).set(bearer(other.access)).send({ submissionId: subId(), position: 1, optionId: q.correctOptionId })).status, 404);
  });

  it('premium ends exactly at expiry: new premium actions are denied from that instant', async () => {
    const s = await signup(t);
    await wrongMany(s, 2, 250);
    const paid = await buyPremium(t, s);
    const exp = new Date(paid.body.grant.grantedUntil);
    const created = await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({ list: 'unresolved', order: 'recent' });
    assert.equal(created.status, 201);
    const saved = t.clock.t;
    try {
      // A month later the original tokens/session are long expired: authenticate for real at exp - 1 ms.
      t.clock.set(new Date(exp.getTime() - 1));
      assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 401);
      const fresh = await signin(t, s.email);
      const before = await request(t.server).get('/api/v1/premium').set(bearer(fresh.access));
      assert.equal(before.body.active, true);
      assert.equal((await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(fresh.access)).send({ list: 'unresolved', order: 'recent' })).status, 201);
      // one millisecond later the SAME valid access token still authenticates, but premium is over
      t.clock.set(exp);
      assert.equal((await request(t.server).get('/api/v1/me').set(bearer(fresh.access))).status, 200);
      const late = await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(fresh.access)).send({ list: 'unresolved', order: 'recent' });
      assert.equal(late.status, 403);
      assert.equal(late.body.error.code, 'premium_required');
      const q = byId.get(created.body.items[0].questionId)!;
      const ans = await request(t.server).post(`/api/v1/wrong-notes/replays/${created.body.replay.id}/answers`).set(bearer(fresh.access)).send({ submissionId: subId(), position: 0, optionId: q.correctOptionId });
      assert.equal(ans.status, 403);
      assert.equal((await request(t.server).post('/api/v1/runs').set(bearer(fresh.access)).send({ product: 'personal-mini', scope: 'all', order: 'recent' })).status, 403);
      const status = await request(t.server).get('/api/v1/premium').set(bearer(fresh.access));
      assert.equal(status.body.active, false);
      assert.equal(status.body.expiresAt, exp.toISOString());
      // Paid content remains blocked after expiry; immutable history remains in storage.
      assert.equal((await request(t.server).get(`/api/v1/wrong-notes/replays/${created.body.replay.id}`).set(bearer(fresh.access))).status, 403);
    } finally {
      t.clock.t = saved;
    }
  });

  it('runs need 10 distinct wrong questions; the server picks, times, stores and grades', async () => {
    const s = await signup(t);
    await wrongMany(s, 9, 300);
    await buyPremium(t, s);
    const few = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'unresolved', order: 'recent' });
    assert.equal(few.status, 409);
    assert.equal(few.body.error.details.eligible, 9);
    await wrongMany(s, 1, 309);
    const created = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'unresolved', order: 'recent' });
    assert.equal(created.status, 201);
    const run = created.body.run, items = created.body.items;
    assert.equal(run.status, 'ready');
    assert.equal(items.length, 20);
    assert.equal(run.selection.selectedWrong, 10);
    assert.equal(run.selection.fill, 10);
    assert.ok(items.filter((i: { origin: string }) => i.origin === 'fill').every((i: { item: { exam: number } }) => i.item.exam === 79), 'fill comes from the latest round first');
    assert.ok(!JSON.stringify(items).includes('"correct"'));
    // answering before start is refused
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/0`).set(bearer(s.access)).send({ optionId: null })).status, 409);
    const started = await request(t.server).post(`/api/v1/runs/${run.id}/start`).set(bearer(s.access));
    assert.equal(started.body.run.status, 'active');
    assert.equal(new Date(started.body.run.endsAt).getTime() - new Date(started.body.run.startedAt).getTime(), 30 * 60_000);
    const q0 = byId.get(items[0].questionId)!, q1 = byId.get(items[1].questionId)!;
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/0`).set(bearer(s.access)).send({ optionId: q0.correctOptionId })).status, 200);
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/1`).set(bearer(s.access)).send({ optionId: wrongOf(q1) })).status, 200);
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/2`).set(bearer(s.access)).send({ optionId: q0.correctOptionId })).status, 400);
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/99`).set(bearer(s.access)).send({ optionId: null })).status, 404);
    const mid = await request(t.server).get(`/api/v1/runs/${run.id}`).set(bearer(s.access));
    assert.equal(mid.body.items[0].answerOptionId, q0.correctOptionId);
    assert.equal(mid.body.items[0].result, null);
    const done = await request(t.server).post(`/api/v1/runs/${run.id}/submit`).set(bearer(s.access));
    assert.equal(done.body.run.status, 'final');
    assert.equal(done.body.run.finalReason, 'submit');
    assert.equal(done.body.run.score.correct, 1);
    assert.equal(done.body.run.score.answered, 2);
    assert.equal(done.body.run.score.unanswered, 18);
    assert.equal(done.body.items[0].result.correct, true);
    assert.equal(done.body.items[0].result.correctOptionId, q0.correctOptionId);
    const again = await request(t.server).post(`/api/v1/runs/${run.id}/submit`).set(bearer(s.access));
    assert.deepEqual(again.body.run.score, done.body.run.score);
    const recorded = await pool.query(`SELECT count(*)::int n FROM hanq.attempts WHERE run_id = $1 AND source = 'run'`, [run.id]);
    assert.equal(recorded.rows[0].n, 20);
    assert.equal((await request(t.server).put(`/api/v1/runs/${run.id}/answers/3`).set(bearer(s.access)).send({ optionId: null })).status, 409);
    const other = await signup(t);
    assert.equal((await request(t.server).get(`/api/v1/runs/${run.id}`).set(bearer(other.access))).status, 404);
  });

  it('legacy mini runs: corrected history remains eligible without waiting and normal minimum is retained', async () => {
    let s = await signup(t);
    await wrongMany(s, 11, 500);
    await buyPremium(t, s);
    const latest = mock.filter((m) => m.questionId.startsWith('exam-79-')).sort((x, y) => x.questionId.localeCompare(y.questionId))[0];
    await answer(s, quiz[500], quiz[500].correctOptionId); // corrected now → cooled (would still count under scope 'all')
    await answer(s, latest, latest.correctOptionId);       // never wrong, but the first latest-official filler candidate
    const r = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'all', order: 'recent' });
    assert.equal(r.status, 201);
    const ids = r.body.items.map((i: { questionId: string }) => i.questionId);
    assert.equal(r.body.run.selection.eligibleWrong, 11);
    assert.equal(r.body.run.selection.selectedWrong, 11);
    assert.ok(ids.includes(quiz[500].questionId), 'corrected note remains selected');
    assert.ok(ids.includes(latest.questionId), 'normal filler remains eligible');
    assert.equal(ids.length, 20);
    await answer(s, quiz[501], quiz[501].correctOptionId);
    const few = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'all', order: 'recent' });
    assert.equal(few.status,201);assert.equal(few.body.run.selection.eligibleWrong,11);
    t.clock.advance(24 * 3600_000);
    s = await signin(t, s.email);
    const later = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'all', order: 'recent' });
    assert.equal(later.status, 201);
    assert.equal(later.body.run.selection.eligibleWrong, 11, 'still eligible after 24 h');
  });

  it('new replay queues include correct history immediately and keep existing queue immutable', async () => {
    let s = await signup(t);
    await wrongMany(s, 3, 600);
    await buyPremium(t, s);
    const make = () => request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({ list: 'all', order: 'recent' });
    const before = await make();
    assert.equal(before.status, 201);
    const T = t.clock.now().getTime();
    await answer(s, quiz[600], quiz[600].correctOptionId);
    await answer(s, quiz[600], wrongOf(quiz[600])); // newer wrong cannot cancel the 24 h floor
    const ids = (r: { body: { items: { questionId: string }[] } }) => r.body.items.map((i) => i.questionId);
    const cooled = await make();
    assert.equal(cooled.status, 201);
    assert.deepEqual(ids(cooled).sort(), [quiz[600].questionId,quiz[601].questionId, quiz[602].questionId].sort());
    t.clock.set(new Date(T + 24 * 3600_000 - 60_000));
    s = await signin(t, s.email);
    assert.ok(ids(await make()).includes(quiz[600].questionId), '23:59 remains available');
    t.clock.set(new Date(T + 24 * 3600_000));
    s = await signin(t, s.email);
    assert.ok(ids(await make()).includes(quiz[600].questionId), '24:00');
    const old = await request(t.server).get('/api/v1/wrong-notes/replays/' + before.body.replay.id).set(bearer(s.access));
    assert.deepEqual(ids(old), ids(before), 'existing replay queue is not filtered after the fact');
    const one = await signup(t);
    await wrongMany(one, 1, 610);
    await buyPremium(t, one);
    await answer(one, quiz[610], quiz[610].correctOptionId);
    const none = await request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(one.access)).send({ list: 'all', order: 'recent' });
    assert.equal(none.status,201);assert.equal(none.body.items[0].questionId,quiz[610].questionId);
  });

  it('a run past its deadline is graded with answers saved before the deadline', async () => {
    const s = await signup(t);
    await wrongMany(s, 10, 400);
    await buyPremium(t, s);
    const created = await request(t.server).post('/api/v1/runs').set(bearer(s.access)).send({ product: 'personal-mini', scope: 'unresolved', order: 'random' });
    const id = created.body.run.id;
    await request(t.server).post(`/api/v1/runs/${id}/start`).set(bearer(s.access));
    const q0 = byId.get(created.body.items[0].questionId)!;
    await request(t.server).put(`/api/v1/runs/${id}/answers/0`).set(bearer(s.access)).send({ optionId: q0.correctOptionId });
    const saved = t.clock.t;
    try {
      t.clock.advance(30 * 60_000); // exactly the deadline; the 10-minute access token is expired → real sign-in
      assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 401);
      const fresh = await signin(t, s.email);
      const late = await request(t.server).put(`/api/v1/runs/${id}/answers/1`).set(bearer(fresh.access)).send({ optionId: null });
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, 'run_expired');
      const r = await request(t.server).get(`/api/v1/runs/${id}`).set(bearer(fresh.access));
      assert.equal(r.body.run.status, 'final');
      assert.equal(r.body.run.finalReason, 'expired');
      assert.equal(r.body.run.finalAt, created.body.run.endsAt ?? r.body.run.endsAt);
      assert.equal(r.body.run.score.correct, 1);
      // graded exactly once, no matter how often it is read or submitted afterwards
      await request(t.server).get(`/api/v1/runs/${id}`).set(bearer(fresh.access));
      const sub = await request(t.server).post(`/api/v1/runs/${id}/submit`).set(bearer(fresh.access));
      assert.equal(sub.body.run.finalReason, 'expired');
      const n = await pool.query(`SELECT count(*)::int n FROM hanq.attempts WHERE run_id = $1`, [id]);
      assert.equal(n.rows[0].n, 20);
    } finally {
      t.clock.t = saved;
    }
  });
});
