import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/common/app-error';
import type { DbService } from '../../src/db/db.service';
import { SourceAttemptRepository, type CompleteSourceAttempt } from '../../src/textbook/source-attempt-repository';

const user = '10000000-0000-4000-8000-000000000001';
const input = (): CompleteSourceAttempt => ({
  attemptId: '20000000-0000-4000-8000-000000000002', payloadHash: Buffer.alloc(32, 1),
  scope: { quizId: 'synthetic', sourceVersion: 'a'.repeat(64), gradingVersion: 2, sourceRevision: 'synthetic-r1' },
  correct: 8, total: 10,
});
const existing = () => ({
  id: input().attemptId, seq: '17', quiz_id: 'synthetic', source_version: 'a'.repeat(64), grading_version: 2,
  source_revision: 'synthetic-r1', payload_hash: Buffer.alloc(32, 1) as Buffer, correct: 8, total: 10,
  score_xp: 10, rewarded: true, xp_award: 10, completed_at: new Date('2026-01-01T00:00:00Z'), award_day: '2026-01-01',
});
type Row = ReturnType<typeof existing>;
const tier = (correct: number, total: number) => correct * 100 >= total * 80 ? 10 : correct * 100 >= total * 70 ? 5 : correct * 100 >= total * 60 ? 1 : 0;
function harness() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const state = { rows: [] as Row[], ledger: 0, credits: [] as number[], failLedger: false, missing: false, transactions: 0, rollbacks: 0, day: '2026-01-01', seq: 17 };
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM hanq.users')) return { rows: [{ '?column?': 1 }] };
    if (state.missing) throw Object.assign(new Error('synthetic missing relation'), { code: '42P01' });
    if (sql.startsWith('SELECT * FROM hanq.source_full_attempts') && sql.includes('quiz_id=$2')) {
      return { rows: state.rows.filter(r => r.quiz_id === params[1] && r.source_version === params[2] && r.grading_version === params[3] && r.source_revision === params[4])
        .sort((a, b) => Number(b.seq) - Number(a.seq)).slice(0, 5) };
    }
    if (sql.startsWith('SELECT * FROM hanq.source_full_attempts')) return { rows: state.rows.filter(r => r.id === params[1]) };
    if (sql.startsWith('INSERT INTO hanq.source_full_attempts')) {
      // Mirrors the SQL: reward only when the score earns XP and no rewarded row exists for this quiz and day.
      const [, id, quiz, version, grading, revision, hash, correct, total, earns] = params as [string, string, string, string, 1 | 2, string, Buffer, number, number, boolean];
      const rewarded = earns && !state.rows.some(r => r.rewarded && r.quiz_id === quiz && r.source_revision === revision && r.award_day === state.day);
      const score = tier(correct, total);
      const row: Row = { id, seq: String(state.seq++), quiz_id: quiz, source_version: version, grading_version: grading as 2, source_revision: revision,
        payload_hash: hash, correct, total, score_xp: score, rewarded, xp_award: rewarded ? score : 0, completed_at: new Date(state.day + 'T00:00:00Z'), award_day: state.day };
      state.rows.push(row); return { rows: [row] };
    }
    if (sql.includes('INSERT INTO hanq.growth_ledger')) {
      if (state.failLedger) throw new Error('synthetic ledger failure');
      state.ledger++; state.credits.push(params[2] as number); return { rows: [] };
    }
    throw new Error('unexpected test query');
  };
  const db = {
    pool: { query },
    tx: async (fn: (q: { query: typeof query }) => Promise<unknown>) => {
      state.transactions++; const rows = [...state.rows], ledger = state.ledger, credits = [...state.credits];
      try { return await fn({ query }); }
      catch (error) { state.rows = rows; state.ledger = ledger; state.credits = credits; state.rollbacks++; throw error; }
    },
  } as unknown as DbService;
  return { repo: new SourceAttemptRepository(db), state, calls };
}

describe('full source attempt repository orchestration (synthetic DB adapter)', () => {
  it('looks up an immutable owner-scoped replay without loading source or awarding XP', async () => {
    const h = harness();
    assert.equal(await h.repo.replay(user, input().attemptId, input().payloadHash), null);
    h.state.rows = [existing()];
    const result = await h.repo.replay(user, input().attemptId, input().payloadHash);
    assert.equal(result?.replayed, true); assert.equal(result?.attempt.xpAward, 10);
    assert.deepEqual(h.calls[0].params, [user, input().attemptId]);
    assert.equal(h.state.transactions, 0); assert.equal(h.state.ledger, 0);
    await assert.rejects(h.repo.replay(user, input().attemptId, Buffer.alloc(32, 2)),
      (e: unknown) => e instanceof AppError && e.getStatus() === 409);
  });
  it('locks owner first and stores receipt plus exact award in one transaction', async () => {
    const h = harness(); const result = await h.repo.complete(user, input());
    assert.equal(h.state.transactions, 1);
    assert.match(h.calls[0].sql, /users WHERE id = \$1 FOR UPDATE/);
    assert.deepEqual(h.calls[0].params, [user]);
    assert.equal(result.replayed, false); assert.equal(result.attempt.xpAward, 10);
    assert.equal(result.attempt.rewarded, true); assert.equal(result.attempt.scoreXp, 10);
    assert.equal(result.attempt.sequence, '17');
    assert.equal(h.state.rows.length, 1); assert.equal(h.state.ledger, 1);
    const credit = h.calls.find(c => c.sql.includes('INSERT INTO hanq.growth_ledger'))!;
    assert.deepEqual(credit.params, [user, input().attemptId, 10, existing().completed_at]);
    assert.match(credit.sql, /source-full-quiz/); assert.doesNotMatch(credit.sql, /ON CONFLICT/);
    const insert = h.calls.find(c => c.sql.startsWith('INSERT INTO hanq.source_full_attempts'))!;
    assert.match(insert.sql, /AT TIME ZONE 'Asia\/Seoul'/); assert.match(insert.sql, /NOT EXISTS/);
    assert.equal(insert.params[9], true, 'only an XP-earning score asks for the daily reward');
  });
  it('rewards XP once per quiz per KST day; later completions keep their record and score with 0 XP', async () => {
    const h = harness(); const id = (n: number) => '20000000-0000-4000-8000-00000000000' + n;
    const first = await h.repo.complete(user, { ...input(), attemptId: id(1), correct: 7 });
    const second = await h.repo.complete(user, { ...input(), attemptId: id(2), payloadHash: Buffer.alloc(32, 2), correct: 10 });
    assert.deepEqual([first.attempt.rewarded, first.attempt.xpAward, first.attempt.scoreXp], [true, 5, 5]);
    assert.deepEqual([second.attempt.rewarded, second.attempt.xpAward, second.attempt.scoreXp], [false, 0, 10], 'better score later the same day earns nothing');
    assert.deepEqual(h.state.credits, [5, 0], 'every completion writes exactly one ledger event, the repeat with 0');
    const other = await h.repo.complete(user, { ...input(), attemptId: id(3), payloadHash: Buffer.alloc(32, 3), scope: { ...input().scope, quizId: 'other' } });
    assert.equal(other.attempt.xpAward, 10, 'the limit is per quiz');
    h.state.day = '2026-01-02';
    const tomorrow = await h.repo.complete(user, { ...input(), attemptId: id(4), payloadHash: Buffer.alloc(32, 4) });
    assert.equal(tomorrow.attempt.xpAward, 10, 'a new KST day rewards again');
    const list = await h.repo.list(user, input().scope);
    assert.deepEqual(list.items.map(a => [a.id, a.xpAward]), [[id(4), 10], [id(2), 0], [id(1), 5]], 'history keeps unrewarded repeats, newest first');
    assert.equal(list.latest?.id, id(4));
    assert.equal(h.calls.some(c => /\b(DELETE\s+FROM|UPDATE\s+hanq\.)/i.test(c.sql)), false, 'no record is rewritten or removed');
  });
  it('a below-60% completion does not use up the day; the next passing completion is rewarded', async () => {
    const h = harness(); const id = (n: number) => '30000000-0000-4000-8000-00000000000' + n;
    const fail = await h.repo.complete(user, { ...input(), attemptId: id(1), correct: 5 });
    assert.deepEqual([fail.attempt.rewarded, fail.attempt.xpAward, fail.attempt.scoreXp], [false, 0, 0]);
    assert.equal(h.calls.find(c => c.sql.startsWith('INSERT INTO hanq.source_full_attempts'))!.params[9], false);
    const pass = await h.repo.complete(user, { ...input(), attemptId: id(2), payloadHash: Buffer.alloc(32, 2), correct: 6 });
    assert.deepEqual([pass.attempt.rewarded, pass.attempt.xpAward], [true, 1]);
    assert.deepEqual(h.state.credits, [0, 1]);
  });
  it('replaying the rewarded attempt after a later repeat returns the original award, never a second one', async () => {
    const h = harness(); const id = (n: number) => '40000000-0000-4000-8000-00000000000' + n;
    await h.repo.complete(user, { ...input(), attemptId: id(1) });
    await h.repo.complete(user, { ...input(), attemptId: id(2), payloadHash: Buffer.alloc(32, 2) });
    const replay = await h.repo.complete(user, { ...input(), attemptId: id(1) });
    assert.deepEqual([replay.replayed, replay.attempt.xpAward], [true, 10]);
    assert.deepEqual(h.state.credits, [10, 0]);
  });
  it('replays a durable receipt without inserting or crediting again', async () => {
    const h = harness(); h.state.rows = [existing()];
    const result = await h.repo.complete(user, input());
    assert.equal(result.replayed, true); assert.equal(result.attempt.completedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(h.state.ledger, 0); assert.equal(h.calls.some(c => c.sql.startsWith('INSERT')), false);
  });
  it('rejects changed hash, source scope, or score under a used identity', async () => {
    for (const change of [
      { payloadHash: Buffer.alloc(32, 2) },
      { scope: { ...input().scope, sourceRevision: 'synthetic-r2' } },
      { correct: 7 },
    ]) {
      const h = harness(); h.state.rows = [existing()];
      await assert.rejects(h.repo.complete(user, { ...input(), ...change }),
        (e: unknown) => e instanceof AppError && e.getStatus() === 409 && e.code === 'source_attempt_conflict');
      assert.equal(h.state.ledger, 0); assert.equal(h.state.rollbacks, 1);
    }
  });
  it('rolls back the receipt when ledger credit fails', async () => {
    const h = harness(); h.state.failLedger = true;
    await assert.rejects(h.repo.complete(user, input()), /synthetic ledger failure/);
    assert.equal(h.state.rows.length, 0); assert.equal(h.state.ledger, 0); assert.equal(h.state.rollbacks, 1);
  });
  it('lists only newest five in exact owner/source/grading scope without deletion', async () => {
    const h = harness(); h.state.rows = [existing()];
    const result = await h.repo.list(user, input().scope);
    assert.equal(result.latest?.id, result.items[0].id);
    assert.match(h.calls[0].sql, /ORDER BY seq DESC LIMIT 5/);
    assert.deepEqual(h.calls[0].params, [user, 'synthetic', 'a'.repeat(64), 2, 'synthetic-r1']);
    assert.equal(h.calls.some(c => /DELETE|UPDATE/.test(c.sql)), false);
  });
  it('fails closed with 503 when proposal schema has not been separately applied', async () => {
    const h = harness(); h.state.missing = true;
    const unavailable = (e: unknown) => e instanceof AppError && e.getStatus() === 503 && e.code === 'source_attempt_schema_not_ready';
    await assert.rejects(h.repo.complete(user, input()), unavailable);
    await assert.rejects(h.repo.replay(user, input().attemptId, input().payloadHash), unavailable);
    await assert.rejects(h.repo.list(user, input().scope), unavailable);
    assert.equal(h.state.rows.length, 0); assert.equal(h.state.ledger, 0);
  });
  it('rejects malformed attempt identity, hash, or impossible counts before any transaction', async () => {
    for (const change of [{ attemptId: 'bad' }, { payloadHash: Buffer.alloc(1) }, { correct: 11 }, { total: 0 }]) {
      const h = harness();
      await assert.rejects(h.repo.complete(user, { ...input(), ...change }),
        (e: unknown) => e instanceof AppError && e.getStatus() === 400);
      assert.equal(h.state.transactions, 0);
    }
  });
});
