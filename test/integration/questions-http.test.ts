import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { projectRoot } from '../../src/common/project-root';
import { parseGlobalAssignment } from '../../src/questions/catalog-loader';
import { buyPremium, bearer, signup, startApp, subId, type TestApp } from '../helpers/app';
import { freshDatabase, frontCatalog } from '../helpers/db';
import { testConfig } from '../helpers/env';

const FRONT = resolve(projectRoot(), process.env.HANQ_FRONT_DIR?.trim() || '../hanq_front');
const rawQuiz = parseGlobalAssignment(readFileSync(join(FRONT, 'media', 'quiz-catalog.js'), 'utf8'), 'HANQ_QUIZ_CATALOG') as { questions: Record<string, Record<string, unknown>> };
const FORBIDDEN = new Set(['answer', 'a', 'compound', 'correct', 'review', 'why', 'cue', 'overview', 'legacy', 'sources', 'source', 'dedup', 'rv', 'flags', 'kind', 'duplicateOf', 'correctOptionId']);

function forbiddenKeys(x: unknown, path = ''): string[] {
  if (Array.isArray(x)) return x.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (x && typeof x === 'object') return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => [...(FORBIDDEN.has(k) && path.startsWith('.item') ? [`${path}.${k}`] : []), ...forbiddenKeys(v, `${path}.${k}`)]);
  return [];
}

describe('pre-grade question responses over HTTP (all 1490 real items)', () => {
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

  it('GET /questions/:id for every item: no answer-bearing key, options only {id,text}', async () => {
    const leaks: string[] = [];
    for (const q of frontCatalog()) {
      const r = await request(t.server).get(`/api/v1/questions/${q.questionId}`);
      assert.equal(r.status, 200, q.questionId);
      assert.equal(r.body.version, q.version);
      leaks.push(...forbiddenKeys(r.body).map((p) => q.questionId + p));
      for (const o of r.body.item.options) assert.deepEqual(Object.keys(o).sort(), ['id', 'text'], q.questionId);
      assert.deepEqual(r.body.item.options.map((o: { id: string }) => o.id).sort(), [...q.optionIds].sort());
    }
    assert.deepEqual(leaks, []);
  });

  it('the 11 real compound items never expose their composite answer before grading', async () => {
    const compound = Object.values(rawQuiz.questions).filter((r) => r.compound != null);
    assert.equal(compound.length, 11);
    for (const raw of compound) {
      const r = await request(t.server).get(`/api/v1/questions/${String(raw.id)}`);
      const text = JSON.stringify(r.body);
      assert.equal(r.status, 200, String(raw.id));
      assert.ok(!text.includes('"compound"'), String(raw.id));
      // The composite answer object never appears (its parts may legitimately appear inside option texts, since all
      // options are shown — but never as a structured answer field).
      assert.ok(!text.includes(JSON.stringify(raw.compound)), String(raw.id));
      for (const k of Object.keys(raw.compound as object)) assert.ok(!text.includes(`"${k}":`) || ['id', 'text', 'q', 'prompt', 'ask', 'chapter', 'shape', 'v', 'mode', 'options', 'relatedEras'].includes(k), `${String(raw.id)} exposes ${k}`);
    }
    const one = await request(t.server).get('/api/v1/questions/legacy-joseon-late-012');
    if (one.status === 200) assert.equal(one.body.item.compound, undefined);
  });

  it('the paginated list endpoint (all pages, both kinds) carries no answer-bearing key', async () => {
    let seen = 0;
    for (const kind of ['quiz', 'mock']) {
      let after: string | null = null;
      do {
        const r: { status: number; body: { items: Array<{ questionId: string }>; next: string | null } } = await request(t.server).get(`/api/v1/questions?kind=${kind}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
        assert.equal(r.status, 200);
        for (const it of r.body.items) assert.deepEqual(forbiddenKeys(it), [], it.questionId);
        seen += r.body.items.length;
        after = r.body.next;
      } while (after);
    }
    assert.equal(seen, frontCatalog().length);
  });

  it('the full original (including compound) is returned only after the caller\'s own graded submission', async () => {
    const s = await signup(t); await buyPremium(t,s);
    const raw = Object.values(rawQuiz.questions).find((r) => r.compound != null)!;
    const q = frontCatalog().find((x) => x.questionId === raw.id)!;
    const r = await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({ submissionId: subId(), questionId: q.questionId, version: q.version, optionId: q.correctOptionId });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.review.item.compound, raw.compound);
    assert.equal(r.body.review.correctOptionId, q.correctOptionId);
  });
});
