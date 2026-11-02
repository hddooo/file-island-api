import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AttemptRow, NewAttempt } from '../../src/attempts/attempts.repository';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { AttemptsService } from '../../src/attempts/attempts.service';
import { accountSubmissionId, IMPORT_MAX_PER_KEY, ImportService, type ImportEntry } from '../../src/attempts/import.service';
import { sha256, sha256hex } from '../../src/common/util';
import type { DbService, Queryable } from '../../src/db/db.service';
import type { QuestionRow, QuestionsRepository } from '../../src/questions/questions.repository';

/* Mocked persistence only (no database, no .env): the real ImportService + AttemptsService grading/idempotency logic runs
   over an in-memory attempts table and import_batches row, so the cap accounting can be checked exhaustively. */
const QUESTION: QuestionRow = {
  question_id: 'q-cap-1', version: 'v1', kind: 'quiz', is_current: true, chapter: 'prehistory', era: null, related_eras: [],
  exam_round: null, exam_number: null, points: 1, option_ids: ['o1', 'o2', 'o3', 'o4'], correct_option_id: 'o2', public_payload: {}, review_payload: {},
};

function harness() {
  const rows = new Map<string, AttemptRow>(); // key: user|submission
  const batches = new Map<string, { user_id: string; accepted: number; received: number }>();
  let seq = 0;
  const q: Queryable = {
    query: (async (text: string, params: unknown[] = []) => {
      if (text.startsWith('SELECT 1 FROM hanq.users') && text.includes('FOR UPDATE')) return { rows: [] }; // owner lock (first statement)
      if (text.startsWith('UPDATE hanq.wrong_note_review_state SET correct_streak = 0')) return { rows: [] }; // a new wrong breaks the study streak
      const key = (params[0] as Buffer).toString('hex');
      if (text.startsWith('INSERT INTO hanq.import_batches')) { if (!batches.has(key)) batches.set(key, { user_id: params[1] as string, accepted: 0, received: 0 }); return { rows: [] }; }
      if (text.startsWith('SELECT user_id, accepted FROM hanq.import_batches')) return { rows: [{ ...batches.get(key)! }] };
      if (text.startsWith('UPDATE hanq.import_batches')) { const b = batches.get(key)!; b.received += params[1] as number; b.accepted += params[2] as number; return { rows: [] }; }
      throw new Error('unexpected query ' + text);
    }) as unknown as Queryable['query'],
  };
  const repo = new (class extends AttemptsRepository {
    override async insert(_q: Queryable, a: NewAttempt) {
      const k = a.userId + '|' + a.submissionId;
      if (rows.has(k)) return null;
      const row: AttemptRow = { id: a.id, seq: String(++seq), user_id: a.userId, submission_id: a.submissionId, question_id: a.questionId, version: a.version,
        option_id: a.optionId, correct: a.correct, source: a.source, replay_id: null, run_id: null, payload_hash: a.payloadHash, reported_at: a.reportedAt ?? null, created_at: a.now };
      rows.set(k, row);
      return row;
    }
    override async findBySubmission(_q: Queryable, userId: string, submissionId: string) { return rows.get(userId + '|' + submissionId) ?? null; }
  })();
  const clock = { now: () => new Date('2026-10-09T00:00:00Z') };
  const db = { pool: q, tx: async <T>(fn: (q: Queryable) => Promise<T>) => fn(q) } as unknown as DbService;
  const questions = { getVersions: async () => [QUESTION] } as unknown as QuestionsRepository;
  const attempts = new AttemptsService(clock, db, repo, questions);
  const svc = new ImportService(clock, db, questions, attempts, repo);
  return { svc, rows, batches };
}

const KEY = 'k'.repeat(43);
let n = 0;
const entry = (optionId: string | null = 'o1'): ImportEntry => ({ localId: 'a' + (++n).toString(36).padStart(8, '0'), mode: 'quiz', questionId: QUESTION.question_id, contentVersion: 'v1', optionId });

describe('import cap counts accepted unique attempts, not resent payloads', () => {
  it('a failed-network resend of the same batch is acknowledged and never charged again', async () => {
    const h = harness(), batch = Array.from({ length: 500 }, () => entry());
    const a = await h.svc.importLocal('u1', KEY, batch);
    const b = await h.svc.importLocal('u1', KEY, batch); // client did not see the first response and retried with the same key
    const c = await h.svc.importLocal('u1', KEY, batch);
    assert.deepEqual([a.imported, a.alreadyImported, b.imported, b.alreadyImported, c.imported, c.alreadyImported], [500, 0, 0, 500, 0, 500]);
    const row = [...h.batches.values()][0];
    assert.equal(row.accepted, 500, 'retries are not charged against the cap');
    assert.equal(row.received, 1500, 'received stays an informational counter');
    assert.equal(h.rows.size, 500);
    assert.equal(a.grantsPremium, false);
  });

  it('at the cap new entries are skipped, already-imported entries are still acknowledged, and resends never drain the cap', async () => {
    const h = harness(), first: ImportEntry[] = [];
    for (let i = 0; i < IMPORT_MAX_PER_KEY / 500; i++) {
      const batch = Array.from({ length: 500 }, () => entry());
      first.push(...batch);
      assert.equal((await h.svc.importLocal('u1', KEY, batch)).imported, 500);
      assert.equal((await h.svc.importLocal('u1', KEY, batch)).alreadyImported, 500, 'retry of every batch is free');
    }
    assert.equal([...h.batches.values()][0].accepted, IMPORT_MAX_PER_KEY);
    const fresh = [entry(), entry()];
    const mixed = await h.svc.importLocal('u1', KEY, [first[0], fresh[0], first[1], fresh[1]]);
    assert.equal(mixed.imported, 0);
    assert.equal(mixed.alreadyImported, 2);
    assert.deepEqual(mixed.skipped, fresh.map((e) => ({ localId: e.localId, reason: 'import-cap-reached' })));
    assert.equal(mixed.received, 4);
    assert.equal(h.rows.size, IMPORT_MAX_PER_KEY);
  });

  it('just below the cap only the remaining room is accepted, in request order', async () => {
    const h = harness();
    for (let i = 0; i < IMPORT_MAX_PER_KEY / 500 - 1; i++) await h.svc.importLocal('u1', KEY, Array.from({ length: 500 }, () => entry()));
    const last = Array.from({ length: 499 }, () => entry());
    assert.equal((await h.svc.importLocal('u1', KEY, last)).imported, 499);
    const over = [entry(), entry(), entry()];
    const r = await h.svc.importLocal('u1', KEY, over);
    assert.equal(r.imported, 1);
    assert.deepEqual(r.skipped.map((s) => s.localId), [over[1].localId, over[2].localId]);
    assert.ok(r.skipped.every((s) => s.reason === 'import-cap-reached'));
    assert.equal([...h.batches.values()][0].accepted, IMPORT_MAX_PER_KEY);
  });

  it('re-grades on the server and still reports per-entry skips', async () => {
    const h = harness();
    const right = entry('o2'), wrong = entry('o3'), unknown = entry('zz'), blank = entry(null);
    const r = await h.svc.importLocal('u1', KEY, [right, wrong, unknown, blank, right]);
    assert.equal(r.imported, 2);
    assert.deepEqual(r.skipped.map((s) => s.reason), ['unknown-option', 'unanswered-record', 'duplicate-in-request']);
    const stored = [...h.rows.values()].map((x) => [x.option_id, x.correct, x.source]);
    assert.deepEqual(stored, [['o2', true, 'import'], ['o3', false, 'import']]);
  });

  it('another account cannot use a key bound to the first account', async () => {
    const h = harness();
    await h.svc.importLocal('u1', KEY, [entry()]);
    await assert.rejects(h.svc.importLocal('u2', KEY, [entry()]), (e: unknown) => (e as { code?: string }).code === 'import_key_owned_by_another_account');
  });

  it('account scope: the same local record under two different keys of one owner is stored once (canonical user+localId id)', async () => {
    const h = harness(), e = entry(), keyA = 'A'.repeat(43), keyB = 'B'.repeat(43);
    const [a, b] = await Promise.all([h.svc.importLocal('u1', keyA, [e], 'account'), h.svc.importLocal('u1', keyB, [e], 'account')]);
    assert.equal(a.imported + b.imported, 1);
    assert.equal(a.alreadyImported + b.alreadyImported, 1);
    assert.equal(h.rows.size, 1);
    assert.equal([...h.rows.values()][0].submission_id, accountSubmissionId('u1', e.localId));
    const again = await h.svc.importLocal('u1', 'C'.repeat(43), [e], 'account');
    assert.deepEqual([again.imported, again.alreadyImported], [0, 1], 'a third key is acknowledged, not duplicated');
    assert.equal([...h.batches.values()].reduce((n, x) => n + x.accepted, 0), 1, 'only the one real row is charged against any cap');
  });

  it('account scope ids are per user: another account with the same localId gets its own row', async () => {
    const h = harness(), e = entry();
    await h.svc.importLocal('u1', 'A'.repeat(43), [e], 'account');
    await h.svc.importLocal('u2', 'B'.repeat(43), [e], 'account');
    assert.equal(h.rows.size, 2);
    assert.notEqual(accountSubmissionId('u1', e.localId), accountSubmissionId('u2', e.localId));
  });

  it('legacy (browser) scope keeps the original keyHash|localId ids, so old same-key retries still replay', async () => {
    const h = harness(), e = entry();
    await h.svc.importLocal('u1', KEY, [e]);
    const legacy = 'imp-' + sha256hex(sha256('hanq-import:' + KEY).toString('hex') + '|' + e.localId).slice(0, 40);
    assert.equal([...h.rows.values()][0].submission_id, legacy);
    assert.equal((await h.svc.importLocal('u1', KEY, [e])).alreadyImported, 1);
    assert.notEqual(legacy, accountSubmissionId('u1', e.localId), 'the two id spaces never collide');
  });
});
