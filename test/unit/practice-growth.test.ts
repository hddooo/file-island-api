import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AttemptRow, NewAttempt } from '../../src/attempts/attempts.repository';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { AttemptsService } from '../../src/attempts/attempts.service';
import type { DbService, Queryable } from '../../src/db/db.service';
import type { QuestionRow, QuestionsRepository } from '../../src/questions/questions.repository';

/* Mocked persistence (no database): checks which ledger write submitPractice makes for each case. The real constraints
   (one row per attempt, rollback without 008, concurrency) are covered by test/integration/practice-growth.test.ts. */
const Q = (kind: 'quiz' | 'mock'): QuestionRow => ({ question_id: kind + '-1', version: 'v1', kind, is_current: true, chapter: 'samguk', era: null, related_eras: [],
  exam_round: null, exam_number: null, points: 2, option_ids: ['o1', 'o2'], correct_option_id: 'o1', public_payload: {}, review_payload: {} });

function harness(kind: 'quiz' | 'mock', existingSource?: AttemptRow['source']) {
  const rows = new Map<string, AttemptRow>(), ledger: { amount: number; attempt: string; kind: string }[] = [], log: string[] = [];
  const q: Queryable = {
    query: (async (text: string, p: unknown[] = []) => {
      if (text.startsWith('SELECT 1 FROM hanq.users') && text.includes('FOR UPDATE')) { log.push('lock'); return { rows: [] }; }
      if (text.startsWith('UPDATE hanq.wrong_note_review_state SET correct_streak = 0')) { log.push('reset:' + p[1]); return { rows: [] }; }
      if (text.includes('premium_state')) return { rows: [{}], rowCount: 1 }; // access gate: allowed
      if (text.includes('INSERT INTO hanq.growth_ledger')) { ledger.push({ attempt: p[1] as string, kind: p[2] as string, amount: p[3] as number }); return { rows: [] }; }
      if (text.includes('SELECT amount FROM hanq.growth_ledger')) return { rows: ledger.filter((x) => x.attempt === p[1]).map((x) => ({ amount: x.amount })) };
      if ((text.includes('sum(amount)') || text.includes('SELECT xp::text points FROM hanq.owned_digimon'))) return { rows: [{ points: 1000 + ledger.reduce((n, x) => n + x.amount, 0) }] };
      throw new Error('unexpected ' + text);
    }) as unknown as Queryable['query'],
  };
  const repo = new (class extends AttemptsRepository {
    override async insert(_q: Queryable, a: NewAttempt) {
      if (rows.has(a.submissionId)) return null;
      const r = { id: 'id-' + a.submissionId, seq: '1', user_id: a.userId, submission_id: a.submissionId, question_id: a.questionId, version: a.version, option_id: a.optionId, correct: a.correct,
        source: a.source, replay_id: null, run_id: null, payload_hash: a.payloadHash, reported_at: null, created_at: a.now } as AttemptRow;
      rows.set(a.submissionId, r); return r;
    }
    override async findBySubmission(_q: Queryable, _u: string, sid: string) { return rows.get(sid) ?? null; }
  })();
  const db = { pool: q, tx: async <T>(fn: (q: Queryable) => Promise<T>) => fn(q) } as unknown as DbService;
  const questions = { getVersion: async () => Q(kind) } as unknown as QuestionsRepository;
  const svc = new AttemptsService({ now: () => { log.push('clock'); return new Date('2026-10-09T00:00:00Z'); } }, db, repo, questions);
  if (existingSource) rows.set('sid-x', { id: 'id-x', submission_id: 'sid-x', source: existingSource, payload_hash: Buffer.alloc(32) } as AttemptRow);
  return { svc, ledger, log, q };
}
const dto = (optionId: string, submissionId = 'sid-1') => ({ submissionId, questionId: 'q', version: 'v1', optionId });

describe('ordinary practice: owner lock first, confirmation clock after the wait, new wrong breaks the study streak', () => {
  it('the owner row lock is the first statement and the server clock is read only after it', async () => {
    const h = harness('quiz');
    await h.svc.submitPractice('u1', dto('o1'));
    assert.equal(h.log[0], 'lock');
    assert.ok(h.log.indexOf('clock') > h.log.indexOf('lock'));
  });
  it('a new wrong answer resets the wrong-note correct streak; a correct one or a replay does not', async () => {
    const h = harness('quiz');
    await h.svc.submitPractice('u1', dto('o2', 'sid-w'));
    assert.deepEqual(h.log.filter((x) => x.startsWith('reset:')), ['reset:quiz-1']);
    await h.svc.submitPractice('u1', dto('o2', 'sid-w')); // replay of the same submission
    await h.svc.submitPractice('u1', dto('o1', 'sid-c'));
    assert.equal(h.log.filter((x) => x.startsWith('reset:')).length, 1);
  });
});

describe('ordinary practice growth amounts (server-graded, once per recorded attempt)', () => {
  it('quiz: correct +1, wrong -1; mock: original 2-point correct +2, wrong -2', async () => {
    for (const [kind, opt, delta, ledgerKind] of [['quiz', 'o1', 1, 'practice-quiz'], ['quiz', 'o2', -1, 'practice-quiz'], ['mock', 'o1', 2, 'practice-mock'], ['mock', 'o2', -2, 'practice-mock']] as const) {
      const h = harness(kind);
      const r = await h.svc.submitPractice('u1', dto(opt));
      assert.deepEqual(r.growth, { delta, points: 1000 + delta });
      assert.deepEqual(h.ledger.map((x) => [x.kind, x.amount, x.attempt]), [[ledgerKind, delta, 'id-sid-1']]);
    }
  });
  it('replaying the same submission returns the original delta and writes nothing', async () => {
    const h = harness('mock');
    await h.svc.submitPractice('u1', dto('o2'));
    const again = await h.svc.submitPractice('u1', dto('o2'));
    assert.equal(again.replayed, true);
    assert.deepEqual(again.growth, { delta: -2, points: 998 });
    assert.equal(h.ledger.length, 1);
  });
  it('a new submission id on the same question is a new grade and a new reward', async () => {
    const h = harness('quiz');
    await h.svc.submitPractice('u1', dto('o2', 'sid-1'));
    await h.svc.submitPractice('u1', dto('o1', 'sid-2'));
    assert.deepEqual(h.ledger.map((x) => x.amount), [-1, 1]);
  });
  it('a submission id already used by a non-practice record (import/replay) never earns a practice reward', async () => {
    const h = harness('quiz', 'import');
    await assert.rejects(h.svc.submitPractice('u1', dto('o1', 'sid-x')), (e: unknown) => (e as { code?: string }).code === 'submission_conflict');
    assert.equal(h.ledger.length, 0);
  });
});

// New history grading policy uses the same immutable attempt identity in replay/finalized practice paths.
it('history replay and legacy run award only a new attempt; study-managed/import are handled separately',async()=>{for(const source of ['wrong-replay','run','import'] as const){const h=harness('mock'),a={submissionId:'repeat-one',question:Q('mock'),optionId:'o2',source};const first=await h.svc.record(h.q,'u1',a,new Date('2026-10-24T00:00:00Z'));const again=await h.svc.record(h.q,'u1',a,new Date('2026-10-24T00:00:00Z'));assert.equal(first.replayed,false);assert.equal(again.replayed,true);assert.equal(h.ledger.length,source==='import'?0:1);if(source!=='import')assert.equal(h.ledger[0].amount,-2);}const h=harness('quiz');await h.svc.record(h.q,'u1',{submissionId:'managed',question:Q('quiz'),optionId:'o1',source:'run',studyManaged:true},new Date());assert.equal(h.ledger.length,0,'managed run writes one aggregate ledger entry later');});
