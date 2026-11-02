import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export interface RunRow {
  id: string;
  user_id: string;
  seq: number;
  product: 'personal-mini' | 'personal-formal';
  size: number;
  duration_ms: number;
  status: 'ready' | 'active' | 'final';
  selection: Record<string, unknown>;
  created_at: Date;
  started_at: Date | null;
  ends_at: Date | null;
  final_at: Date | null;
  final_reason: 'submit' | 'expired' | null;
  score: Record<string, unknown> | null;
}

export interface RunItemRow {
  position: number;
  question_id: string;
  version: string;
  origin: 'wrong-quiz' | 'wrong-mock' | 'fill';
  points: number;
  points_kind: 'official' | 'practice';
  option_ids: string[];
  answer_option_id: string | null;
  answered_at: Date | null;
  correct: boolean | null;
  attempt_id: string | null;
  kind: 'quiz' | 'mock';
  public_payload: Record<string, unknown>;
  correct_option_id: string;
  review_payload: Record<string, unknown>;
}

@Injectable()
export class RunsRepository {
  async nextSeq(q: Queryable, userId: string): Promise<number> {
    const r = await q.query<{ n: number }>('SELECT coalesce(max(seq), 0)::int + 1 AS n FROM hanq.runs WHERE user_id = $1', [userId]);
    return r.rows[0].n;
  }

  async insert(q: Queryable, r: { id: string; userId: string; seq: number; product: string; size: number; durationMs: number; selection: unknown; now: Date }): Promise<void> {
    await q.query(
      `INSERT INTO hanq.runs (id, user_id, seq, product, size, duration_ms, status, selection, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $8)`,
      [r.id, r.userId, r.seq, r.product, r.size, r.durationMs, JSON.stringify(r.selection), r.now],
    );
  }

  async insertItems(q: Queryable, runId: string, items: { questionId: string; version: string; origin: string; points: number; pointsKind: string; optionIds: string[] }[]): Promise<void> {
    await q.query(
      `INSERT INTO hanq.run_items (run_id, position, question_id, version, origin, points, points_kind, option_ids)
       SELECT $1, x.position, x.question_id, x.version, x.origin, x.points, x.points_kind, ARRAY(SELECT jsonb_array_elements_text(x.option_ids))
         FROM jsonb_to_recordset($2::jsonb) AS x(position int, question_id text, version text, origin text, points int, points_kind text, option_ids jsonb)`,
      [runId, JSON.stringify(items.map((it, i) => ({ position: i, question_id: it.questionId, version: it.version, origin: it.origin, points: it.points, points_kind: it.pointsKind, option_ids: it.optionIds })))],
    );
  }

  async findOwned(q: Queryable, id: string, userId: string, forUpdate = false): Promise<RunRow | null> {
    const r = await q.query<RunRow>(`SELECT * FROM hanq.runs WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId]);
    return r.rows[0] ?? null;
  }

  async listOwned(q: Queryable, userId: string): Promise<RunRow[]> {
    const r = await q.query<RunRow>('SELECT * FROM hanq.runs WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 50', [userId]);
    return r.rows;
  }

  async items(q: Queryable, runId: string): Promise<RunItemRow[]> {
    const r = await q.query<RunItemRow>(
      `SELECT i.*, qv.kind, qv.public_payload, qv.correct_option_id, coalesce(m.review_payload->'questionReview',qv.review_payload) AS review_payload
         FROM hanq.run_items i
         JOIN hanq.question_versions qv ON qv.question_id = i.question_id AND qv.version = i.version
         JOIN hanq.runs owner ON owner.id=i.run_id
         LEFT JOIN hanq.manual_wrong_notes m ON m.user_id=owner.user_id AND m.question_id=i.question_id AND m.version=i.version
        WHERE i.run_id = $1 ORDER BY i.position`,
      [runId],
    );
    return r.rows;
  }

  async start(q: Queryable, id: string, now: Date, endsAt: Date): Promise<void> {
    await q.query(`UPDATE hanq.runs SET status = 'active', started_at = $2, ends_at = $3 WHERE id = $1 AND status = 'ready'`, [id, now, endsAt]);
  }

  async setAnswer(q: Queryable, runId: string, position: number, optionId: string | null, now: Date): Promise<number> {
    const r = await q.query('UPDATE hanq.run_items SET answer_option_id = $3, answered_at = $4 WHERE run_id = $1 AND position = $2', [runId, position, optionId, optionId === null ? null : now]);
    return r.rowCount ?? 0;
  }

  async gradeItem(q: Queryable, runId: string, position: number, correct: boolean, attemptId: string): Promise<void> {
    await q.query('UPDATE hanq.run_items SET correct = $3, attempt_id = $4 WHERE run_id = $1 AND position = $2', [runId, position, correct, attemptId]);
  }

  async finalize(q: Queryable, id: string, at: Date, reason: 'submit' | 'expired', score: unknown): Promise<void> {
    await q.query(`UPDATE hanq.runs SET status = 'final', final_at = $2, final_reason = $3, score = $4 WHERE id = $1 AND status = 'active'`, [id, at, reason, JSON.stringify(score)]);
  }
}
