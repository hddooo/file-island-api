import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';
import { isStudyEligible, studyEligibleAt } from './study-policy';

export interface WrongStateRow {
  question_id: string;
  version: string;
  kind: 'quiz' | 'mock';
  era: string | null;
  related_eras: string[];
  wrong_count: number;
  attempt_count: number;
  last_wrong_at: Date | null;
  last_wrong_option_id: string | null;
  last_correct: boolean;
  public_payload: Record<string, unknown>;
  manual_added_at?: Date | null;
  manual_review?: Record<string, unknown> | null;
}

export interface StaleRow {
  question_id: string;
  wrong_count: number;
  last_wrong_at: Date;
}

/** Current owner notes combine truthful attempt history and separate idempotent book memberships.
 * Manual registration never invents an attempt or a wrong-answer timestamp. */
@Injectable()
export class WrongNotesRepository {
  async current(q: Queryable, userId: string): Promise<WrongStateRow[]> {
    const r = await q.query<WrongStateRow>(
      `WITH history AS (
       SELECT a.question_id,a.version,count(*) FILTER(WHERE NOT a.correct)::int wrong_count,count(*)::int attempt_count,
              max(a.created_at) FILTER(WHERE NOT a.correct) last_wrong_at,
              (array_agg(a.option_id ORDER BY a.seq DESC) FILTER(WHERE NOT a.correct))[1] last_wrong_option_id,
              (array_agg(a.correct ORDER BY a.seq DESC))[1] last_correct,max(a.seq) last_seq
         FROM hanq.visible_wrong_attempts a JOIN hanq.question_versions v ON v.question_id=a.question_id AND v.version=a.version AND v.is_current
        WHERE a.user_id=$1 GROUP BY a.question_id,a.version
      )
      SELECT v.question_id,v.version,v.kind,v.era,v.related_eras,v.public_payload,
             coalesce(h.wrong_count,0)::int wrong_count,coalesce(h.attempt_count,0)::int attempt_count,
             h.last_wrong_at,h.last_wrong_option_id,
             CASE WHEN m.question_id IS NULL THEN coalesce(h.last_correct,false)
                  ELSE coalesce(latest.created_at>=m.added_at AND latest.correct,false) END last_correct,
             m.added_at manual_added_at,m.review_payload manual_review
        FROM hanq.question_versions v
        LEFT JOIN history h ON h.question_id=v.question_id AND h.version=v.version
        LEFT JOIN hanq.visible_manual_wrong_notes m ON m.question_id=v.question_id AND m.user_id=$1
        LEFT JOIN LATERAL(SELECT a.correct,a.created_at FROM hanq.visible_wrong_attempts a WHERE a.user_id=$1 AND a.question_id=v.question_id ORDER BY a.seq DESC LIMIT 1) latest ON m.question_id IS NOT NULL
       WHERE v.is_current AND (coalesce(h.wrong_count,0)>0 OR m.question_id IS NOT NULL)
       ORDER BY coalesce(greatest(h.last_wrong_at,m.added_at),h.last_wrong_at,m.added_at) DESC,v.question_id`,
      [userId],
    );
    return r.rows;
  }

  /** Compatibility view for existing queue callers; spaced dates are informational. */
  async cooldown(q: Queryable, userId: string, now: Date) {
    const history = await this.current(q, userId);
    const lastCorrect = await this.lastCorrectAt(q, userId);
    const states = await q.query<{ question_id: string; version: string; exposure_count: number; next_review_at: Date | null }>('SELECT question_id, version, exposure_count, next_review_at FROM hanq.wrong_note_review_state WHERE user_id = $1', [userId]);
    const state = new Map(states.rows.map((x) => [x.question_id + '|' + x.version, x]));
    const eligibleAt = new Map<string, Date | null>(), cooled = new Set<string>();
    for (const x of history) {
      const at = studyEligibleAt({ lastCorrectAt: lastCorrect.get(x.question_id) ?? null, latestCorrect: x.last_correct, nextReviewAt: state.get(x.question_id + '|' + x.version)?.next_review_at ?? null });
      eligibleAt.set(x.question_id, at);
      if (!isStudyEligible(at, now)) cooled.add(x.question_id);
    }
    return { history, eligibleAt, cooled, exposure: new Map(states.rows.map((x) => [x.question_id + '|' + x.version, x.exposure_count])) };
  }

  /** Latest server-confirmed correct answer per STABLE question id across all versions and attempt sources (truthful history). */
  async lastCorrectAt(q: Queryable, userId: string): Promise<Map<string, Date>> {
    const r = await q.query<{ question_id: string; at: Date }>('SELECT question_id, max(created_at) AS at FROM hanq.visible_wrong_attempts WHERE user_id = $1 AND correct GROUP BY question_id', [userId]);
    return new Map(r.rows.map((x) => [x.question_id, x.at]));
  }

  async stale(q: Queryable, userId: string): Promise<StaleRow[]> {
    const r = await q.query<StaleRow>(
      `SELECT a.question_id, count(*)::int AS wrong_count, max(a.created_at) AS last_wrong_at
         FROM hanq.visible_wrong_attempts a
         JOIN hanq.question_versions qv ON qv.question_id = a.question_id AND qv.version = a.version AND NOT qv.is_current
        WHERE a.user_id = $1 AND NOT a.correct
          AND NOT EXISTS (
            SELECT 1 FROM hanq.visible_wrong_attempts b
              JOIN hanq.question_versions cv ON cv.question_id = b.question_id AND cv.version = b.version AND cv.is_current
             WHERE b.user_id = $1 AND b.question_id = a.question_id)
        GROUP BY a.question_id
        ORDER BY max(a.created_at) DESC
        LIMIT 500`,
      [userId],
    );
    return r.rows;
  }

  // ---- replays ----
  async insertReplay(q: Queryable, r: { id: string; userId: string; list: string; ord: string; size: number; now: Date; part?:string }): Promise<void> {
    await q.query('INSERT INTO hanq.replays (id, user_id, list, ord, size, created_at, part) VALUES ($1, $2, $3, $4, $5, $6, $7)', [r.id, r.userId, r.list, r.ord, r.size, r.now, r.part ?? null]);
  }

  async insertReplayItems(q: Queryable, replayId: string, items: { questionId: string; version: string; optionIds: string[] }[]): Promise<void> {
    await q.query(
      `INSERT INTO hanq.replay_items (replay_id, position, question_id, version, option_ids)
       SELECT $1, x.position, x.question_id, x.version, ARRAY(SELECT jsonb_array_elements_text(x.option_ids))
         FROM jsonb_to_recordset($2::jsonb) AS x(position int, question_id text, version text, option_ids jsonb)`,
      [replayId, JSON.stringify(items.map((it, i) => ({ position: i, question_id: it.questionId, version: it.version, option_ids: it.optionIds })))],
    );
  }

  async findReplayOwned(q: Queryable, id: string, userId: string, forUpdate = false) {
    const r = await q.query<{ id: string; part:string|null; list: string; ord: string; size: number; created_at: Date; finished_at: Date | null }>(
      `SELECT id, part, list, ord, size, created_at, finished_at FROM hanq.replays WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, userId],
    );
    return r.rows[0] ?? null;
  }

  async replayItems(q: Queryable, replayId: string) {
    const r = await q.query<{ position: number; question_id: string; version: string; option_ids: string[]; attempt_id: string | null; public_payload: Record<string, unknown>; kind: 'quiz' | 'mock'; option_id: string | null; correct: boolean | null; correct_option_id: string; review_payload: Record<string, unknown> }>(
      `SELECT i.position, i.question_id, i.version, i.option_ids, i.attempt_id, qv.public_payload, qv.kind, a.option_id, a.correct,
              qv.correct_option_id, coalesce(m.review_payload->'questionReview',qv.review_payload) AS review_payload
         FROM hanq.replay_items i
         JOIN hanq.question_versions qv ON qv.question_id = i.question_id AND qv.version = i.version
         JOIN hanq.replays owner ON owner.id=i.replay_id
         LEFT JOIN hanq.visible_manual_wrong_notes m ON m.user_id=owner.user_id AND m.question_id=i.question_id AND m.version=i.version
         LEFT JOIN hanq.visible_wrong_attempts a ON a.id = i.attempt_id
        WHERE i.replay_id = $1
        ORDER BY i.position`,
      [replayId],
    );
    return r.rows;
  }

  async setReplayItemAttempt(q: Queryable, replayId: string, position: number, attemptId: string): Promise<void> {
    await q.query('UPDATE hanq.replay_items SET attempt_id = $3 WHERE replay_id = $1 AND position = $2 AND attempt_id IS NULL', [replayId, position, attemptId]);
  }

  async finishReplayIfDone(q: Queryable, replayId: string, now: Date): Promise<void> {
    await q.query(
      `UPDATE hanq.replays SET finished_at = $2
        WHERE id = $1 AND finished_at IS NULL AND NOT EXISTS (SELECT 1 FROM hanq.replay_items WHERE replay_id = $1 AND attempt_id IS NULL)`,
      [replayId, now],
    );
  }

  async listReplays(q: Queryable, userId: string) {
    const r = await q.query<{ id: string; part:string|null; list: string; ord: string; size: number; created_at: Date; finished_at: Date | null; answered: number }>(
      `SELECT r.id, r.part, r.list, r.ord, r.size, r.created_at, r.finished_at,
              (SELECT count(*)::int FROM hanq.replay_items i WHERE i.replay_id = r.id AND i.attempt_id IS NOT NULL) AS answered
         FROM hanq.replays r WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 30`,
      [userId],
    );
    return r.rows;
  }
}
