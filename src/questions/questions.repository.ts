import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';
import type { SeedQuestion } from './catalog-loader';

export interface QuestionRow {
  question_id: string;
  version: string;
  kind: 'quiz' | 'mock';
  is_current: boolean;
  chapter: string | null;
  era: string | null;
  related_eras: string[];
  exam_round: number | null;
  exam_number: number | null;
  points: number;
  option_ids: string[];
  correct_option_id: string;
  public_payload: Record<string, unknown>;
  review_payload: Record<string, unknown>;
}

const PUBLIC_COLS = 'question_id, version, kind, is_current, chapter, era, related_eras, exam_round, exam_number, points, option_ids, public_payload';

export type PublicQuestionRow = Omit<QuestionRow, 'correct_option_id' | 'review_payload'>;

@Injectable()
export class QuestionsRepository {
  /** Full row (with answer) for grading. Server-internal only. */
  async getVersion(q: Queryable, questionId: string, version: string): Promise<QuestionRow | null> {
    const r = await q.query<QuestionRow>('SELECT * FROM hanq.question_versions WHERE question_id = $1 AND version = $2', [questionId, version]);
    return r.rows[0] ?? null;
  }

  async getVersions(q: Queryable, pairs: { questionId: string; version: string }[]): Promise<QuestionRow[]> {
    if (!pairs.length) return [];
    const r = await q.query<QuestionRow>(
      `SELECT qv.* FROM hanq.question_versions qv
         JOIN unnest($1::text[], $2::text[]) AS p(question_id, version) USING (question_id, version)`,
      [pairs.map((p) => p.questionId), pairs.map((p) => p.version)],
    );
    return r.rows;
  }

  async getCurrentPublic(q: Queryable, questionId: string): Promise<PublicQuestionRow | null> {
    const r = await q.query<PublicQuestionRow>(`SELECT ${PUBLIC_COLS} FROM hanq.question_versions WHERE question_id = $1 AND is_current AND public_payload->>'visibility' IS DISTINCT FROM 'authenticated-members'`, [questionId]);
    return r.rows[0] ?? null;
  }

  async listCurrentPublic(q: Queryable, f: { kind?: 'quiz' | 'mock'; era?: string; afterId?: string; limit: number }): Promise<PublicQuestionRow[]> {
    const r = await q.query<PublicQuestionRow>(
      `SELECT ${PUBLIC_COLS} FROM hanq.question_versions
        WHERE is_current AND public_payload->>'visibility' IS DISTINCT FROM 'authenticated-members'
          AND ($1::text IS NULL OR kind = $1)
          AND ($2::text IS NULL OR era = $2 OR $2 = ANY (related_eras))
          AND ($3::text IS NULL OR question_id > $3)
        ORDER BY question_id
        LIMIT $4`,
      [f.kind ?? null, f.era ?? null, f.afterId ?? null, f.limit],
    );
    return r.rows;
  }

  /** Latest official rounds first (79 → 70), then question number — the same fill order as the front's local runs. */
  async latestOfficial(q: Queryable, excludeIds: string[], limit: number): Promise<QuestionRow[]> {
    if (limit <= 0) return [];
    const r = await q.query<QuestionRow>(
      `SELECT * FROM hanq.question_versions
        WHERE is_current AND kind = 'mock' AND NOT (question_id = ANY ($1::text[]))
        ORDER BY exam_round DESC, exam_number ASC
        LIMIT $2`,
      [excludeIds, limit],
    );
    return r.rows;
  }

  async counts(q: Queryable): Promise<{ quiz: number; mock: number }> {
    const r = await q.query<{ kind: string; n: string }>(`SELECT kind, count(*)::text AS n FROM hanq.question_versions WHERE is_current AND public_payload->>'visibility' IS DISTINCT FROM 'authenticated-members' GROUP BY kind`);
    const by = Object.fromEntries(r.rows.map((x) => [x.kind, Number(x.n)]));
    return { quiz: by.quiz ?? 0, mock: by.mock ?? 0 };
  }

  // ---- seeding (scripts/seed.ts and tests) ----

  async insertMissing(q: Queryable, items: SeedQuestion[], now: Date): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      const r = await q.query(
        `INSERT INTO hanq.question_versions
           (question_id, version, kind, is_current, chapter, era, related_eras, exam_round, exam_number, points, option_ids, correct_option_id,
            public_payload, review_payload, content_hash, seeded_at)
         SELECT x.question_id, x.version, x.kind, false, x.chapter, x.era,
                ARRAY(SELECT jsonb_array_elements_text(x.related_eras)), x.exam_round, x.exam_number, x.points,
                ARRAY(SELECT jsonb_array_elements_text(x.option_ids)), x.correct_option_id, x.public_payload, x.review_payload, x.content_hash, $2
           FROM jsonb_to_recordset($1::jsonb) AS x(question_id text, version text, kind text, chapter text, era text, related_eras jsonb,
                exam_round int, exam_number int, points int, option_ids jsonb, correct_option_id text, public_payload jsonb, review_payload jsonb, content_hash text)
         ON CONFLICT (question_id, version) DO NOTHING`,
        [
          JSON.stringify(chunk.map((s) => ({
            question_id: s.questionId, version: s.version, kind: s.kind, chapter: s.chapter, era: s.era, related_eras: s.relatedEras,
            exam_round: s.examRound, exam_number: s.examNumber, points: s.points, option_ids: s.optionIds, correct_option_id: s.correctOptionId,
            public_payload: s.publicPayload, review_payload: s.reviewPayload, content_hash: s.contentHash,
          }))),
          now,
        ],
      );
      inserted += r.rowCount ?? 0;
    }
    return inserted;
  }

  /** The public payload is DERIVED from the immutable source item. When the derivation changes (e.g. a field removed
   *  from the allow-list) the stored public payload of identical source content is re-derived. Answers/reviews never change here. */
  async refreshPublic(q: Queryable, items: SeedQuestion[]): Promise<number> {
    let changed = 0;
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      const r = await q.query(
        `UPDATE hanq.question_versions qv SET public_payload = x.public_payload
           FROM jsonb_to_recordset($1::jsonb) AS x(question_id text, version text, content_hash text, public_payload jsonb)
          WHERE qv.question_id = x.question_id AND qv.version = x.version AND qv.content_hash = x.content_hash
            AND qv.public_payload IS DISTINCT FROM x.public_payload`,
        [JSON.stringify(chunk.map((s) => ({ question_id: s.questionId, version: s.version, content_hash: s.contentHash, public_payload: s.publicPayload })))],
      );
      changed += r.rowCount ?? 0;
    }
    return changed;
  }

  async hashes(q: Queryable, items: SeedQuestion[]): Promise<Map<string, string>> {
    const r = await q.query<{ question_id: string; version: string; content_hash: string }>(
      `SELECT question_id, version, content_hash FROM hanq.question_versions
         JOIN unnest($1::text[], $2::text[]) AS p(question_id, version) USING (question_id, version)`,
      [items.map((s) => s.questionId), items.map((s) => s.version)],
    );
    return new Map(r.rows.map((x) => [x.question_id + '\u0000' + x.version, x.content_hash]));
  }

  /** Makes exactly the seeded (id, version) pairs current; anything else (older versions, retired questions) becomes non-current. */
  async setCurrent(q: Queryable, items: SeedQuestion[]): Promise<{ retired: number; promoted: number }> {
    const ids = items.map((s) => s.questionId), versions = items.map((s) => s.version);
    const off = await q.query(
      `UPDATE hanq.question_versions qv SET is_current = false
        WHERE qv.is_current AND NOT EXISTS (SELECT 1 FROM hanq.manual_wrong_notes m WHERE m.question_id=qv.question_id AND NOT(qv.question_id=ANY($1::text[]))) AND NOT EXISTS (
          SELECT 1 FROM unnest($1::text[], $2::text[]) AS p(question_id, version) WHERE p.question_id = qv.question_id AND p.version = qv.version)`,
      [ids, versions],
    );
    const on = await q.query(
      `UPDATE hanq.question_versions qv SET is_current = true
         FROM unnest($1::text[], $2::text[]) AS p(question_id, version)
        WHERE qv.question_id = p.question_id AND qv.version = p.version AND NOT qv.is_current`,
      [ids, versions],
    );
    return { retired: off.rowCount ?? 0, promoted: on.rowCount ?? 0 };
  }
}
