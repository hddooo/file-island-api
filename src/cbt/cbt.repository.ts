import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';
import type { QuestionRow } from '../questions/questions.repository';
import { CBT_DURATION_MS } from './cbt-policy';

export interface CbtRunRow {
  id: string;
  user_id: string;
  idempotency_key: string;
  exam_round: number;
  status: 'ready' | 'active' | 'final';
  checkpoint_version: number;
  pause_submission_key: string | null;
  pause_payload_hash: string | null;
  answer_mode: 'legacy' | 'batch';
  paused_at: Date | null;
  pause_remaining_ms: number | null;
  paused_total_ms: string | number;
  batch_submission_key: string | null;
  batch_payload_hash: string | null;
  duration_ms: number;
  current_position: number;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  ends_at: Date | null;
  final_at: Date | null;
  final_reason: 'submit' | 'expired' | null;
  result: Record<string, unknown> | null;
}

export interface CbtItemRow {
  position: number;
  question_id: string;
  version: string;
  exam_number: number;
  points: number;
  option_ids: string[];
  answer_option_id: string | null;
  answered_at: Date | null;
  correct: boolean | null;
  attempt_id: string | null;
  era: string | null;
  public_payload: Record<string, unknown>;
  correct_option_id: string;
  review_payload: Record<string, unknown>;
}

/** Every owned lookup filters on user_id: another user's run is indistinguishable from a missing one. */
@Injectable()
export class CbtRepository {
  /** Current versions of one official round (validated by the caller; nothing is filled in). */
  async roundQuestions(q: Queryable, round: number): Promise<QuestionRow[]> {
    const r = await q.query<QuestionRow>(
      `SELECT * FROM hanq.question_versions WHERE is_current AND kind = 'mock' AND exam_round = $1 ORDER BY exam_number`,
      [round],
    );
    return r.rows;
  }

  async allRoundQuestions(q: Queryable, rounds: readonly number[]): Promise<QuestionRow[]> {
    const r = await q.query<QuestionRow>(
      `SELECT * FROM hanq.question_versions WHERE is_current AND kind = 'mock' AND exam_round = ANY ($1::int[]) ORDER BY exam_round DESC, exam_number`,
      [rounds],
    );
    return r.rows;
  }

  /** Study chapters that exist as current quiz content: the only era ids a link may point at. */
  async validEraIds(q: Queryable): Promise<Set<string>> {
    const r = await q.query<{ chapter: string }>(`SELECT DISTINCT chapter FROM hanq.question_versions WHERE is_current AND kind = 'quiz' AND chapter IS NOT NULL`);
    return new Set(r.rows.map((x) => x.chapter));
  }

  /** Concurrency-safe create: the unique (user_id, idempotency_key) index decides; a racing duplicate gets null. */
  async insertRun(q: Queryable, r: { id: string; userId: string; key: string; round: number; now: Date; mode?: string }): Promise<boolean> {
    const res = await q.query(
      `INSERT INTO hanq.cbt_runs (id, user_id, idempotency_key, exam_round, status, duration_ms, current_position, created_at, updated_at, answer_mode)
       VALUES ($1, $2, $3, $4, 'ready', $5, 0, $6, $6, $7)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [r.id, r.userId, r.key, r.round, CBT_DURATION_MS, r.now, r.mode ?? 'legacy'],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async insertItems(q: Queryable, runId: string, userId: string, rows: QuestionRow[]): Promise<void> {
    await q.query(
      `INSERT INTO hanq.cbt_run_items (run_id, user_id, position, question_id, version, exam_number, points, option_ids)
       SELECT $1, $2, x.position, x.question_id, x.version, x.exam_number, x.points, ARRAY(SELECT jsonb_array_elements_text(x.option_ids))
         FROM jsonb_to_recordset($3::jsonb) AS x(position int, question_id text, version text, exam_number int, points int, option_ids jsonb)`,
      [runId, userId, JSON.stringify(rows.map((r, i) => ({ position: i, question_id: r.question_id, version: r.version, exam_number: r.exam_number, points: r.points, option_ids: r.option_ids })))],
    );
  }

  async findByKey(q: Queryable, userId: string, key: string): Promise<CbtRunRow | null> {
    const r = await q.query<CbtRunRow>('SELECT * FROM hanq.cbt_runs WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
    return r.rows[0] ?? null;
  }

  async findOwned(q: Queryable, id: string, userId: string, forUpdate = false): Promise<CbtRunRow | null> {
    const r = await q.query<CbtRunRow>(`SELECT * FROM hanq.cbt_runs WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId]);
    return r.rows[0] ?? null;
  }

  async listOwned(q: Queryable, userId: string): Promise<(CbtRunRow & { answered: number })[]> {
    const r = await q.query<CbtRunRow & { answered: number }>(
      `WITH ranked_final AS (
           SELECT id, row_number() OVER (
             PARTITION BY exam_round ORDER BY final_at DESC NULLS LAST, created_at DESC, id
           ) AS recent_rank
             FROM hanq.cbt_runs WHERE user_id = $1 AND status = 'final'
         ), selected AS (
           SELECT id FROM ranked_final WHERE recent_rank <= 3
           UNION ALL
           (SELECT id FROM hanq.cbt_runs WHERE user_id = $1 AND status IN ('ready', 'active')
            ORDER BY created_at DESC, id LIMIT 100)
         )
         SELECT r.*, (SELECT count(*)::int FROM hanq.cbt_run_items i WHERE i.run_id = r.id AND i.answer_option_id IS NOT NULL) AS answered
           FROM hanq.cbt_runs r JOIN selected s ON s.id = r.id
          WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id`,
      [userId],
    );
    return r.rows;
  }

  async dueRunIds(q: Queryable, userId: string, now: Date): Promise<string[]> {
    const r = await q.query<{ id: string }>(`SELECT id FROM hanq.cbt_runs WHERE user_id = $1 AND status = 'active' AND answer_mode = 'legacy' AND ends_at <= $2`, [userId, now]);
    return r.rows.map((x) => x.id);
  }

  async items(q: Queryable, runId: string): Promise<CbtItemRow[]> {
    const r = await q.query<CbtItemRow>(
      `SELECT i.position, i.question_id, i.version, i.exam_number, i.points, i.option_ids, i.answer_option_id, i.answered_at, i.correct, i.attempt_id,
              qv.era, qv.public_payload, qv.correct_option_id, qv.review_payload
         FROM hanq.cbt_run_items i
         JOIN hanq.question_versions qv ON qv.question_id = i.question_id AND qv.version = i.version
        WHERE i.run_id = $1 ORDER BY i.position`,
      [runId],
    );
    return r.rows;
  }

  /** All graded items of the owner's final runs (newest 200 runs). */
  async finalItems(q: Queryable, userId: string): Promise<(CbtItemRow & { run_id: string })[]> {
    const r = await q.query<CbtItemRow & { run_id: string }>(
      `SELECT i.run_id, i.position, i.question_id, i.version, i.exam_number, i.points, i.option_ids, i.answer_option_id, i.answered_at, i.correct, i.attempt_id,
              qv.era, qv.public_payload, qv.correct_option_id, qv.review_payload
         FROM (SELECT id FROM hanq.cbt_runs WHERE user_id = $1 AND status = 'final' ORDER BY final_at DESC LIMIT 200) r
         JOIN hanq.cbt_run_items i ON i.run_id = r.id
         JOIN hanq.question_versions qv ON qv.question_id = i.question_id AND qv.version = i.version
        ORDER BY i.run_id, i.position`,
      [userId],
    );
    return r.rows;
  }

  async start(q: Queryable, id: string, now: Date, endsAt: Date): Promise<void> {
    await q.query(`UPDATE hanq.cbt_runs SET status = 'active', started_at = $2, ends_at = $3, updated_at = $2 WHERE id = $1 AND status = 'ready'`, [id, now, endsAt]);
  }

  async setAnswer(q: Queryable, runId: string, position: number, optionId: string | null, now: Date): Promise<void> {
    await q.query('UPDATE hanq.cbt_run_items SET answer_option_id = $3, answered_at = $4 WHERE run_id = $1 AND position = $2', [runId, position, optionId, optionId === null ? null : now]);
    await q.query(`UPDATE hanq.cbt_runs SET updated_at = $2 WHERE id = $1 AND status = 'active'`, [runId, now]);
  }

  async setCurrent(q: Queryable, runId: string, position: number, now: Date): Promise<void> {
    await q.query(`UPDATE hanq.cbt_runs SET current_position = $2, updated_at = $3 WHERE id = $1 AND status = 'active'`, [runId, position, now]);
  }

  async gradeItem(q: Queryable, runId: string, position: number, correct: boolean, attemptId: string): Promise<void> {
    await q.query('UPDATE hanq.cbt_run_items SET correct = $3, attempt_id = $4 WHERE run_id = $1 AND position = $2', [runId, position, correct, attemptId]);
  }

  async finalize(q: Queryable, id: string, at: Date, reason: 'submit' | 'expired', result: unknown): Promise<void> {
    await q.query(
      `UPDATE hanq.cbt_runs SET status = 'final', final_at = $2, final_reason = $3, result = $4, updated_at = $2 WHERE id = $1 AND status = 'active'`,
      [id, at, reason, JSON.stringify(result)],
    );
  }
}
