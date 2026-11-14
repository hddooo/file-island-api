import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { DbService } from '../db/db.service';
import { sourceAttemptXp } from './source-attempt-score';

export interface SourceAttemptScope {
  quizId: string;
  sourceVersion: string;
  gradingVersion: 1 | 2;
  sourceRevision: string;
}
export interface CompleteSourceAttempt {
  attemptId: string;
  /** SHA256 of the canonical, server-validated full submission, including scope and mode. */
  payloadHash: Buffer;
  scope: SourceAttemptScope;
  correct: number;
  total: number;
}
export interface CompletedSourceAttempt {
  id: string;
  sequence: string;
  scope: SourceAttemptScope;
  correct: number;
  total: number;
  /** XP actually credited. 0 when the score tier is 0 or today's award for this quiz was already given. */
  xpAward: number;
  /** XP tier the score earns before the daily limit. */
  scoreXp: number;
  /** True only for the one XP-earning completion per owner, quiz and KST day. */
  rewarded: boolean;
  completedAt: string;
}
interface ReceiptRow {
  id: string; seq: string; quiz_id: string; source_version: string; grading_version: 1 | 2;
  source_revision: string; payload_hash: Buffer; correct: number; total: number;
  score_xp: number; rewarded: boolean; xp_award: number; completed_at: Date;
}
const view = (row: ReceiptRow): CompletedSourceAttempt => ({
  id: row.id, sequence: row.seq,
  scope: { quizId: row.quiz_id, sourceVersion: row.source_version, gradingVersion: row.grading_version, sourceRevision: row.source_revision },
  correct: row.correct, total: row.total, xpAward: row.xp_award, scoreXp: row.score_xp, rewarded: row.rewarded,
  completedAt: row.completed_at.toISOString(),
});
const conflict = () => new AppError(409, 'source_attempt_conflict', 'This attempt id was already used for a different submission');
function schemaError(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01') {
    throw new AppError(503, 'source_attempt_schema_not_ready', 'Full quiz attempts are not available');
  }
  throw error;
}

/** Requires the separately reviewed proposal schema. This class never creates or migrates a database.
 * Receipts are durable and append-only; latest-five is a read projection, never a deletion policy. */
@Injectable()
export class SourceAttemptRepository {
  constructor(private readonly db: DbService) {}

  /** Resolve an immutable receipt before reloading mutable current source data. Hash binds the original full scope. */
  async replay(userId: string, attemptId: string, payloadHash: Buffer): Promise<{ attempt: CompletedSourceAttempt; replayed: true } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)
      || !Buffer.isBuffer(payloadHash) || payloadHash.length !== 32) {
      throw new AppError(400, 'invalid_source_attempt', 'Invalid completed full quiz attempt');
    }
    try {
      const result = await this.db.pool.query<ReceiptRow>('SELECT * FROM hanq.source_full_attempts WHERE user_id=$1 AND id=$2', [userId, attemptId]);
      const row = result.rows[0];
      if (!row) return null;
      if (!row.payload_hash.equals(payloadHash)) throw conflict();
      return { attempt: view(row), replayed: true };
    } catch (error) { return schemaError(error); }
  }

  async complete(userId: string, input: CompleteSourceAttempt): Promise<{ attempt: CompletedSourceAttempt; replayed: boolean }> {
    const { scope } = input;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)
      || !Buffer.isBuffer(input.payloadHash) || input.payloadHash.length !== 32
      || !Number.isInteger(input.correct) || !Number.isInteger(input.total)
      || input.total < 1 || input.total > 200 || input.correct < 0 || input.correct > input.total
      || !scope || typeof scope.quizId !== 'string' || scope.quizId.length < 1 || scope.quizId.length > 256
      || typeof scope.sourceVersion !== 'string' || !/^[0-9a-f]{64}$/.test(scope.sourceVersion)
      || ![1, 2].includes(scope.gradingVersion) || typeof scope.sourceRevision !== 'string' || scope.sourceRevision.length < 1 || scope.sourceRevision.length > 128) {
      throw new AppError(400, 'invalid_source_attempt', 'Invalid completed full quiz attempt');
    }
    try {
      return await this.db.tx(async q => {
        // Shared order with grading and partner-equipping transactions. Read clock only after this lock.
        await lockOwner(q, userId);
        const prior = await q.query<ReceiptRow>('SELECT * FROM hanq.source_full_attempts WHERE user_id=$1 AND id=$2', [userId, input.attemptId]);
        if (prior.rows[0]) {
          const row = prior.rows[0];
          if (!row.payload_hash.equals(input.payloadHash) || row.quiz_id !== scope.quizId || row.source_version !== scope.sourceVersion
            || row.grading_version !== scope.gradingVersion || row.source_revision !== scope.sourceRevision
            || row.correct !== input.correct || row.total !== input.total) throw conflict();
          return { attempt: view(row), replayed: true };
        }
        const xp = sourceAttemptXp(input.correct, input.total);
        // One clock reading fixes both the completion time and its KST day. The owner lock above serializes
        // this owner's completions, so the NOT EXISTS check cannot race; the partial unique index is the backstop.
        const result = await q.query<ReceiptRow>(
          `INSERT INTO hanq.source_full_attempts(user_id,id,quiz_id,source_version,grading_version,source_revision,payload_hash,correct,total,completed_at,award_day,rewarded)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,t.at,t.day,
                  $10::boolean AND NOT EXISTS(SELECT 1 FROM hanq.source_full_attempts d
                    WHERE d.user_id=$1 AND d.quiz_id=$3 AND d.source_revision=$6 AND d.award_day=t.day AND d.rewarded)
             FROM (SELECT now_at AS at,(now_at AT TIME ZONE 'Asia/Seoul')::date AS day FROM (SELECT clock_timestamp() AS now_at) c) t
           RETURNING *`,
          [userId, input.attemptId, scope.quizId, scope.sourceVersion, scope.gradingVersion, scope.sourceRevision, input.payloadHash, input.correct, input.total, xp > 0],
        );
        const row = result.rows[0];
        if (row.score_xp !== xp || row.xp_award !== (row.rewarded ? xp : 0)) throw new Error('source attempt XP schema mismatch');
        // Exactly one ledger write, including a zero award. Existing DB triggers credit the equipped partner.
        // Do not ignore conflicts: any inconsistency must roll back the receipt and all credit together.
        await q.query(
          `INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,source_attempt_id,created_at)
           VALUES($1,'source-full:'||$2::uuid::text,'source-full-quiz',$3,$2,$4)`,
          [userId, row.id, row.xp_award, row.completed_at],
        );
        return { attempt: view(row), replayed: false };
      });
    } catch (error) { return schemaError(error); }
  }

  async list(userId: string, scope: SourceAttemptScope): Promise<{ items: CompletedSourceAttempt[]; latest: CompletedSourceAttempt | null }> {
    try {
      const result = await this.db.pool.query<ReceiptRow>(
        `SELECT * FROM hanq.source_full_attempts WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 AND grading_version=$4 AND source_revision=$5
         ORDER BY seq DESC LIMIT 5`,
        [userId, scope.quizId, scope.sourceVersion, scope.gradingVersion, scope.sourceRevision],
      );
      const items = result.rows.map(view);
      return { items, latest: items[0] ?? null };
    } catch (error) { return schemaError(error); }
  }
}
