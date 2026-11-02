import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import type { Pool } from 'pg';
import { assertQuestionAccess, CHAPTER_ORDER } from '../../src/portal/member-state';
import { bearer, buyPremium, signup, startApp, type TestApp } from '../helpers/app';
import { freshDatabase, frontCatalog } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('reward changes preserve actual catalogue access', () => {
  let app: TestApp, pool: Pool;
  before(async () => { pool = await freshDatabase(testConfig()); app = await startApp(); });
  after(async () => { await app.close(); await pool.end(); });
  it('each chapter has exactly five free quiz and mock slots; actual full catalogue and expiry remain authoritative', async () => {
    const s = await signup(app), catalogue = frontCatalog();
    assert.equal(catalogue.filter(q => q.kind === 'quiz').length, 990+catalogue.filter(q=>q.questionId.startsWith('z-reviewed-')).length);
    assert.equal(catalogue.filter(q => q.kind === 'mock').length, 500);
    // Original703 + preserved49 recalls + source238: larger learning catalogue does not widen free5.
    assert.equal(catalogue.filter(q => q.questionId.startsWith('z-connection-')).length, 238);
    const slots = (await pool.query<{ chapter: string; kind: string; question_id: string }>('SELECT chapter, kind, question_id FROM hanq.free_question_slots')).rows;
    for (const chapter of CHAPTER_ORDER) for (const kind of ['quiz', 'mock']) {
      const group = slots.filter(x => x.chapter === chapter && x.kind === kind);
      assert.equal(group.length, 5, chapter + '/' + kind);
      assert.equal(new Set(group.map(x => x.question_id)).size, 5);
      assert.ok(group.every(x => catalogue.some(q => q.questionId === x.question_id && q.kind === kind)));
    }
    assert.ok(!slots.some(x => x.chapter === 'joseon-early' || x.chapter === 'joseon-late'));
    const free = new Set(slots.map(x => x.question_id));
    const question = (q: (typeof catalogue)[number]) => ({ question_id: q.questionId, chapter: q.chapter, era: q.era, kind: q.kind });
    const checkFree = async () => {
      let allowed = 0;
      for (const q of catalogue) {
        if (free.has(q.questionId)) { await assertQuestionAccess(pool, s.userId, question(q), app.clock.now()); allowed++; }
        else await assert.rejects(assertQuestionAccess(pool, s.userId, question(q), app.clock.now()), (e: unknown) => (e as { code?: string }).code === 'premium_required');
      }
      assert.equal(allowed, free.size);
    };
    await checkFree();
    await buyPremium(app, s);
    for (const q of catalogue) await assertQuestionAccess(pool, s.userId, question(q), app.clock.now());
    await pool.query('UPDATE hanq.premium_state SET expires_at=$2 WHERE user_id=$1', [s.userId, app.clock.now()]);
    const me = await request(app.server).get('/api/v1/me').set(bearer(s.access));
    assert.equal(me.body.premium.active, false);
    await checkFree();
  });
});
