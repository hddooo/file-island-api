import type { Pool } from 'pg';
import { checkRound } from '../cbt/cbt-policy';
import { examQuestions, type SeedQuestion } from './catalog-loader';
import { QuestionsRepository, type QuestionRow } from './questions.repository';

const ROUNDS = [67, 68, 69] as const;
const IDS = ROUNDS.flatMap(round => Array.from({ length: 50 }, (_, i) => `exam-${round}-${String(i + 1).padStart(2, '0')}`));
const EXACT = new Set(IDS);
const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

export class CbtAppendError extends Error {
  constructor(readonly reason: 'source_scope' | 'source_item' | 'source_round' | 'existing_conflict' | 'unexpected_write') { super(reason); }
}

/** Validate only the 150 reviewed input questions. Do not load a FE catalog or import any other round. */
export function parseCbt67To69Append(raw: unknown): SeedQuestion[] {
  if (!isObject(raw) || !isObject(raw.questions)) throw new CbtAppendError('source_scope');
  const questions = raw.questions;
  const keys = Object.keys(questions);
  if (keys.length !== IDS.length || keys.some(id => !EXACT.has(id))) throw new CbtAppendError('source_scope');
  for (const id of IDS) {
    const q = questions[id];
    const round = Number(id.slice(5, 7)), number = Number(id.slice(8));
    if (!isObject(q) || q.exam !== round || q.number !== number || typeof q.v !== 'string' || !/^[a-f0-9]{16,64}$/.test(q.v) ||
        !Number.isInteger(q.answer) || Number(q.answer) < 1 || Number(q.answer) > 5 ||
        !Number.isInteger(q.points) || typeof q.negative !== 'boolean')
      throw new CbtAppendError('source_item');
  }
  let items: SeedQuestion[];
  try { items = examQuestions({ questions: Object.fromEntries(IDS.map(id => [id, questions[id]])) }); }
  catch { throw new CbtAppendError('source_item'); }
  const rows = items.map(item => ({
    question_id: item.questionId, kind: item.kind, exam_round: item.examRound,
    exam_number: item.examNumber, option_ids: item.optionIds, correct_option_id: item.correctOptionId, points: item.points,
  }) as QuestionRow);
  if (ROUNDS.some(round => !checkRound(round, rows).ok)) throw new CbtAppendError('source_round');
  return items;
}

/** Append current versions only for new canonical IDs; the normal seed's retirement/promotion and free-slot logic is never called. */
export async function appendCbt67To69(pool: Pick<Pool, 'connect'>, raw: unknown, apply: boolean, now: Date) {
  const items = parseCbt67To69Append(raw);
  const repo = new QuestionsRepository();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same lock as the normal catalog seeder, preventing concurrent seed retirement. A transaction row/unique guard is retained.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hanq.seed_questions'))");
    const existing = (await client.query<{ question_id: string; version: string; is_current: boolean; content_hash: string }>(
      'SELECT question_id,version,is_current,content_hash FROM hanq.question_versions WHERE question_id=ANY($1::text[]) FOR UPDATE', [IDS],
    )).rows;
    const desired = new Map(items.map(item => [item.questionId, item]));
    for (const row of existing) {
      const item = desired.get(row.question_id);
      if (!item || row.version !== item.version || row.content_hash !== item.contentHash || !row.is_current)
        throw new CbtAppendError('existing_conflict');
    }
    const known = new Set(existing.map(row => row.question_id));
    const pending = items.filter(item => !known.has(item.questionId));
    if (apply && pending.length) {
      if (await repo.insertMissing(client, pending, now) !== pending.length) throw new CbtAppendError('unexpected_write');
      const result = await client.query(
        `UPDATE hanq.question_versions q
           SET is_current=true
          FROM unnest($1::text[], $2::text[], $3::text[]) AS p(question_id,version,content_hash)
          WHERE q.question_id=p.question_id AND q.version=p.version AND q.content_hash=p.content_hash AND NOT q.is_current`,
        [pending.map(x => x.questionId), pending.map(x => x.version), pending.map(x => x.contentHash)],
      );
      if (result.rowCount !== pending.length) throw new CbtAppendError('unexpected_write');
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { mode: apply ? 'apply' : 'dry-run', planned: pending.length, inserted: apply ? pending.length : 0, unchanged: known.size };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
