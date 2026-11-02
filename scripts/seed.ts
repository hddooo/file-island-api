import { resolve } from 'node:path';
import { loadDatabaseConfig } from '../src/config/config';
import { projectRoot } from '../src/common/project-root';
import { createPool } from '../src/db/db.service';
import { loadFrontCatalog } from '../src/questions/catalog-loader';
import { seedQuestions } from '../src/questions/question-seeder';

/** npm run seed — loads media/quiz-catalog.js, optional media/era-recall-quiz.js and media/exam-pool.js from the static front (HANQ_FRONT_DIR, default
 *  ../hanq_front) WITHOUT executing them, validates every item and seeds hanq.question_versions idempotently. */
async function main() {
  const { env, database } = loadDatabaseConfig(process.env);
  const frontDir = resolve(projectRoot(), process.env.HANQ_FRONT_DIR?.trim() || '../hanq_front');
  const items = loadFrontCatalog(frontDir);
  const pool = createPool(database);
  try {
    const r = await seedQuestions(pool, items, new Date());
    const quiz = items.filter((i) => i.kind === 'quiz').length;
    console.log(`[seed] ${env}: ${r.total} questions (quiz ${quiz}, exam ${r.total - quiz}); inserted ${r.inserted}, unchanged ${r.unchanged}, public payload re-derived ${r.rederivedPublic}, newly current ${r.promoted}, retired ${r.retired}`);
  } finally {
    await pool.end();
  }
}

main().catch((e: Error & { code?: string }) => {
  const safe = e.name === 'ConfigError' || e.name === 'CatalogError';
  console.error(`[seed] failed: ${e.name}${e.code ? ' code=' + e.code : ''}${safe ? ': ' + e.message : ''}`);
  process.exit(1);
});
