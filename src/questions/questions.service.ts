import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/app-error';
import { DbService } from '../db/db.service';
import { QuestionsRepository, type PublicQuestionRow, type QuestionRow } from './questions.repository';

/** Before grading: id, version, kind and the public payload (no answer / correct flag / reviews). */
export function publicQuestion(r: PublicQuestionRow) {
  return { questionId: r.question_id, version: r.version, kind: r.kind, current: r.is_current, points: r.points, item: r.public_payload };
}

/** After the caller's own graded submission only. */
export function reviewOf(r: QuestionRow) {
  return { correctOptionId: r.correct_option_id, item: r.review_payload };
}

const QID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

@Injectable()
export class QuestionsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QuestionsRepository,
  ) {}

  async list(f: { kind?: 'quiz' | 'mock'; era?: string; after?: string; limit?: number }) {
    if (f.after != null && !QID.test(f.after)) throw new AppError(400, 'invalid_cursor', 'Invalid cursor');
    const limit = f.limit ?? 50;
    const rows = await this.repo.listCurrentPublic(this.db.pool, { kind: f.kind, era: f.era, afterId: f.after, limit: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: page.map(publicQuestion), next: rows.length > limit ? page[page.length - 1].question_id : null };
  }

  async get(questionId: string) {
    if (!QID.test(questionId)) throw notFound();
    const r = await this.repo.getCurrentPublic(this.db.pool, questionId);
    if (!r) throw notFound();
    return publicQuestion(r);
  }

  async counts() {
    return this.repo.counts(this.db.pool);
  }
}
