import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export type AttemptSource = 'practice' | 'wrong-replay' | 'run' | 'import';

export interface AttemptRow {
  id: string;
  seq: string;
  user_id: string;
  submission_id: string;
  question_id: string;
  version: string;
  option_id: string | null;
  correct: boolean;
  source: AttemptSource;
  replay_id: string | null;
  run_id: string | null;
  /** Set only for attempts graded by a CBT run (migration 007). */
  cbt_run_id?: string | null;
  payload_hash: Buffer;
  reported_at: Date | null;
  created_at: Date;
}

export interface NewAttempt {
  id: string;
  userId: string;
  submissionId: string;
  questionId: string;
  version: string;
  optionId: string | null;
  correct: boolean;
  source: AttemptSource;
  replayId?: string | null;
  runId?: string | null;
  cbtRunId?: string | null;
  payloadHash: Buffer;
  reportedAt?: Date | null;
  now: Date;
}

@Injectable()
export class AttemptsRepository {
  /** Returns null if this user already used the submission id (caller decides: identical replay vs conflict). */
  async insert(q: Queryable, a: NewAttempt): Promise<AttemptRow | null> {
    const params: unknown[] = [a.id, a.userId, a.submissionId, a.questionId, a.version, a.optionId, a.correct, a.source, a.replayId ?? null, a.runId ?? null, a.payloadHash, a.reportedAt ?? null, a.now];
    // cbt_run_id (migration 007) is written only by CBT grading; every other caller keeps the original column list.
    const cbt = a.cbtRunId != null;
    if (cbt) params.push(a.cbtRunId);
    const r = await q.query<AttemptRow>(
      `INSERT INTO hanq.attempts (id, user_id, submission_id, question_id, version, option_id, correct, source, replay_id, run_id, payload_hash, reported_at, created_at${cbt ? ', cbt_run_id' : ''})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13${cbt ? ', $14' : ''})
       ON CONFLICT (user_id, submission_id) DO NOTHING
       RETURNING *`,
      params,
    );
    return r.rows[0] ?? null;
  }

  async findBySubmission(q: Queryable, userId: string, submissionId: string): Promise<AttemptRow | null> {
    const r = await q.query<AttemptRow>('SELECT * FROM hanq.attempts WHERE user_id = $1 AND submission_id = $2', [userId, submissionId]);
    return r.rows[0] ?? null;
  }

  async findOwned(q: Queryable, id: string, userId: string): Promise<AttemptRow | null> {
    const r = await q.query<AttemptRow>('SELECT * FROM hanq.attempts WHERE id = $1 AND user_id = $2', [id, userId]);
    return r.rows[0] ?? null;
  }

  /** Newest first, keyset on the identity sequence. */
  async listOwned(q: Queryable, userId: string, beforeSeq: string | null, limit: number): Promise<(AttemptRow & { kind: 'quiz' | 'mock' })[]> {
    const r = await q.query<AttemptRow & { kind: 'quiz' | 'mock' }>(
      `SELECT a.*, qv.kind FROM hanq.attempts a
         JOIN hanq.question_versions qv USING (question_id, version)
        WHERE a.user_id = $1 AND ($2::bigint IS NULL OR a.seq < $2::bigint)
        ORDER BY a.seq DESC
        LIMIT $3`,
      [userId, beforeSeq, limit],
    );
    return r.rows;
  }
  /** Only real submitted answers qualify. Unanswered run items (option_id NULL) never count as solved.
   *  Wrong answers, explicit imports and separate reviews all remain immutable existing history. */
  async quizProgress(q: Queryable, userId: string, pairs: { questionId: string; version: string }[]) {
    const r = await q.query<{ question_id: string; version: string; option_id: string | null; correct: boolean | null; created_at: Date | null }>(
      `SELECT p.question_id, p.version, a.option_id, a.correct, a.created_at
         FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS p(question_id, version, position)
         LEFT JOIN LATERAL (
           SELECT option_id, correct, created_at FROM hanq.attempts
            WHERE user_id = $1 AND question_id = p.question_id AND version = p.version AND option_id IS NOT NULL
            ORDER BY seq DESC LIMIT 1
         ) a ON true
        ORDER BY p.position`,
      [userId, pairs.map(p => p.questionId), pairs.map(p => p.version)],
    );
    return r.rows;
  }

}
