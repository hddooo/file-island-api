import {historyQuestionGrowth,awardHistoryAttempt} from '../common/history-growth';
import { boundedGrowth } from '../common/growth-floor';
import {assertQuestionAccess} from '../portal/member-state';
import { lockOwner } from '../common/owner-lock';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { decodeCursor, encodeCursor, iso, requireUuid, sha256 } from '../common/util';
import { DbService, type Queryable } from '../db/db.service';
import { reviewOf } from '../questions/questions.service';
import { QuestionsRepository, type QuestionRow } from '../questions/questions.repository';
import { AttemptsRepository, type AttemptRow, type AttemptSource } from './attempts.repository';

export const attemptView = (a: AttemptRow, kind?: string) => ({
  id: a.id,
  submissionId: a.submission_id,
  questionId: a.question_id,
  version: a.version,
  ...(kind ? { kind } : {}),
  optionId: a.option_id,
  correct: a.correct,
  source: a.source,
  replayId: a.replay_id,
  runId: a.run_id,
  createdAt: iso(a.created_at),
});

@Injectable()
export class AttemptsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly repo: AttemptsRepository,
    private readonly questions: QuestionsRepository,
  ) {}

  /** Grades on the server (stored correct option), never on anything the client says. Idempotent per (user, submissionId):
   *  the same payload returns the original attempt; a different payload under the same id is rejected. */
  async record(
    q: Queryable,
    userId: string,
    a: { submissionId: string; question: QuestionRow; optionId: string | null; source: AttemptSource; replayId?: string; runId?: string; reportedAt?: Date | null; studyManaged?: boolean },
    now: Date,
  ): Promise<{ attempt: AttemptRow; replayed: boolean }> {
    if (a.optionId !== null && !a.question.option_ids.includes(a.optionId)) throw new AppError(400, 'invalid_option', 'This option does not belong to the question version');
    const correct = a.optionId !== null && a.optionId === a.question.correct_option_id;
    const payloadHash = sha256(JSON.stringify([a.question.question_id, a.question.version, a.optionId, a.source, a.replayId ?? null, a.runId ?? null]));
    const row = await this.repo.insert(q, {
      id: randomUUID(), userId, submissionId: a.submissionId, questionId: a.question.question_id, version: a.question.version,
      optionId: a.optionId, correct, source: a.source, replayId: a.replayId, runId: a.runId, payloadHash, reportedAt: a.reportedAt ?? null, now,
    });
    if (row) {
      // A NEW wrong answer (ordinary practice, import, replay, legacy run) breaks the wrong-note study streak (1 → 3 → 7 days).
      // Timestamps/history stay (the 24 h cooldown is derived from correct attempts). Wrong-note study finalization manages
      // its own streak (studyManaged) so it is never counted twice.
      if (!correct && !a.studyManaged) await q.query('UPDATE hanq.wrong_note_review_state SET correct_streak = 0 WHERE user_id = $1 AND question_id = $2 AND correct_streak <> 0', [userId, a.question.question_id]);
      if(a.source==='wrong-replay'||a.source==='run'&&!a.studyManaged)await awardHistoryAttempt(q,userId,row.id,correct,a.optionId!==null,a.question.kind,a.question.points,now);
      return { attempt: row, replayed: false };
    }
    const existing = await this.repo.findBySubmission(q, userId, a.submissionId);
    if (existing && existing.payload_hash.equals(payloadHash)) return { attempt: existing, replayed: true };
    throw new AppError(409, 'submission_conflict', 'This submission id was already used with a different answer');
  }

  /** Ordinary era practice growth (migration 008): quiz ±1, past-exam mock ±original item points, decided by the server's stored answer.
   *  Written in the SAME transaction as the attempt, keyed by the attempt id (event_key 'practice:<id>', unique attempt_id),
   *  so one recorded attempt gives exactly one ledger row. If 008 is not applied the insert fails (undefined column →
   *  503 schema_not_ready) and the whole transaction — including the new attempt — rolls back: no silent unrewarded grade.
   *  Imports, wrong-note replays, wrong-note study and CBT never call this (they use record() directly). */
  private async practiceGrowth(q: Queryable, userId: string, attempt: AttemptRow, kind: 'quiz' | 'mock', replayed: boolean, now: Date, points:number) {
    let delta: number | null;
    if (!replayed) {
      delta = await boundedGrowth(q,userId,historyQuestionGrowth(attempt.correct,attempt.option_id!==null,kind==='mock'?points:1));
      await q.query(
        `INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, attempt_id, created_at) VALUES ($1, 'practice:' || $2::uuid::text, $3, $4, $2::uuid, $5)`,
        [userId, attempt.id, kind === 'mock' ? 'practice-mock' : 'practice-quiz', delta, now],
      );
    } else {
      // Same submission again: the original result and its original delta (null for attempts graded before 008 — never backfilled).
      const r = await q.query<{ amount: number }>('SELECT amount FROM hanq.growth_ledger WHERE user_id = $1 AND attempt_id = $2', [userId, attempt.id]);
      delta = r.rows[0]?.amount ?? null;
    }
    const total = await q.query<{ points: number }>('SELECT coalesce(sum(amount), 0)::int AS points FROM hanq.growth_ledger WHERE user_id = $1', [userId]);
    return { delta, points: total.rows[0].points };
  }

  /** Free ordinary practice for signed-in users: grade one answer to the CURRENT version of a question. */
  async submitPractice(userId: string, dto: { submissionId: string; questionId: string; version: string; optionId: string }) {
    return this.db.tx(async (q) => {
      await lockOwner(q, userId); // serialize with wrong-note queue issuance; confirmation clock read after the wait
      const now = this.clock.now();
      const prior = await this.repo.findBySubmission(q, userId, dto.submissionId);
      const question = await this.questions.getVersion(q, dto.questionId, dto.version);
      if (!question) throw new AppError(404, 'question_not_found', 'Unknown question or version');
      if (!prior && !question.is_current) throw new AppError(409, 'stale_version', 'This question has a newer version; reload it');
      if(!prior)await assertQuestionAccess(q,userId,question,now);
      const { attempt, replayed } = await this.record(q, userId, { submissionId: dto.submissionId, question, optionId: dto.optionId, source: 'practice' }, now);
      if (attempt.source !== 'practice') throw new AppError(409, 'submission_conflict', 'This submission id was already used with a different answer');
      const growth = await this.practiceGrowth(q, userId, attempt, question.kind, replayed, now,question.points);
      return { attempt: attemptView(attempt, question.kind), replayed, review: reviewOf(question), growth };
    });
  }

  /** Free member progress over the exact selected scope, with no writes or premium gate. */
  async quizProgress(userId: string, pairs: { questionId: string; version: string }[], kind:'quiz'|'mock'='quiz') {
    if (new Set(pairs.map(p => p.questionId)).size !== pairs.length) {
      throw new AppError(400, 'duplicate_question', 'Questions in a scope must be distinct');
    }
    const rows = await this.questions.getVersions(this.db.pool, pairs);
    if (rows.length !== pairs.length || rows.some(q => q.kind !== kind || !q.is_current)) {
      throw new AppError(409, 'stale_quiz_scope', 'Reload the current quiz questions');
    }
    const progress = await this.repo.quizProgress(this.db.pool, userId, pairs);
    return {
      items: progress.map(r => ({ questionId: r.question_id, version: r.version, answered: r.option_id !== null,
        optionId: r.option_id, correct: r.correct, answeredAt: r.created_at ? iso(r.created_at) : null })),
      total: pairs.length,
      answered: progress.filter(r => r.option_id !== null).length,
    };
  }

  async list(userId: string, cursor: string | undefined, limit = 20) {
    const before = decodeCursor(cursor);
    const rows = await this.repo.listOwned(this.db.pool, userId, before, limit + 1);
    const page = rows.slice(0, limit);
    return { items: page.map((r) => attemptView(r, r.kind)), next: rows.length > limit ? encodeCursor(page[page.length - 1].seq) : null };
  }

  /** Someone else's attempt id answers exactly like a missing one (404). */
  async detail(userId: string, id: string) {
    const a = await this.repo.findOwned(this.db.pool, requireUuid(id), userId);
    if (!a) throw notFound();
    const question = await this.questions.getVersion(this.db.pool, a.question_id, a.version);
    return { attempt: attemptView(a, question?.kind), review: question ? reviewOf(question) : null };
  }
}
