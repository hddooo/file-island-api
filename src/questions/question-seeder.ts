import type { Pool } from 'pg';
import { CatalogError, type SeedQuestion } from './catalog-loader';
import { QuestionsRepository } from './questions.repository';

/** Idempotent seed in one transaction under an advisory lock:
 *  - new (id, version) rows are inserted; existing rows are never modified;
 *  - an existing (id, version) whose content differs is an error (versions are immutable — the catalog must bump `v`);
 *  - exactly the seeded versions become current. Attempts keep pointing at their original version. */
export async function seedQuestions(pool: Pool, items: SeedQuestion[], now: Date) {
  const repo = new QuestionsRepository();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('hanq.seed_questions'))`);
    const inserted = await repo.insertMissing(client, items, now);
    const stored = await repo.hashes(client, items);
    const changed = items.filter((s) => stored.get(s.questionId + '\u0000' + s.version) !== s.contentHash).map((s) => s.questionId);
    if (changed.length) throw new CatalogError(`content changed without a new version for ${changed.length} question(s), e.g. ${changed.slice(0, 3).join(', ')}`);
    const rederived = await repo.refreshPublic(client, items);
    const cur = await repo.setCurrent(client, items);
    await client.query(`INSERT INTO hanq.free_question_slots(chapter,kind,position,question_id)
 SELECT chapter,kind,n,question_id FROM(SELECT CASE WHEN coalesce(chapter,era) IN ('joseon-early','joseon-late') THEN 'joseon' ELSE coalesce(chapter,era) END chapter,kind,question_id,row_number() OVER(PARTITION BY CASE WHEN coalesce(chapter,era) IN ('joseon-early','joseon-late') THEN 'joseon' ELSE coalesce(chapter,era) END,kind ORDER BY question_id) n FROM hanq.question_versions WHERE is_current) x WHERE n<=5 AND chapter IS NOT NULL ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO hanq.free_question_slots(chapter,kind,position,question_id)
 SELECT 'islands',kind,n,question_id FROM(SELECT kind,question_id,row_number() OVER(PARTITION BY kind ORDER BY question_id) n FROM hanq.question_versions WHERE is_current AND kind='mock' AND 'islands'=ANY(related_eras)) x WHERE n<=5 ON CONFLICT DO NOTHING`);
    await client.query('COMMIT');
    return { total: items.length, inserted, unchanged: items.length - inserted, rederivedPublic: rederived, retired: cur.retired, promoted: cur.promoted };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
