import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { isLoopbackHost } from '../../src/db/pg-url';
import { projectRoot } from '../../src/common/project-root';
import type { AppConfig } from '../../src/config/config';
import { createPool } from '../../src/db/db.service';
import { migrate } from '../../src/db/migrator';
import { loadFrontCatalog, type SeedQuestion } from '../../src/questions/catalog-loader';
import { seedQuestions } from '../../src/questions/question-seeder';

let catalog: SeedQuestion[] | null = null;

/** The real front catalog (media/quiz-catalog.js + media/exam-pool.js), parsed once per test process. */
export function frontCatalog(): SeedQuestion[] {
  catalog ??= loadFrontCatalog(resolve(projectRoot(), process.env.HANQ_FRONT_DIR?.trim() || '../hanq_front'));
  return catalog;
}

type CurrentRuntimeFixture = { stageFromEnvironment(): { migrations: string }; scope(config: AppConfig): unknown; verifyDatabase(pool: Pool, config: AppConfig): Promise<unknown> };
const loadFixture = createRequire(__filename);
const currentRuntimeFixture = (): CurrentRuntimeFixture | null => process.env.HANQ_QUAL_QUALIFICATION_PROFILE === 'schema61-local-private-retained-base' ? loadFixture('/run/current-runtime-fixture.cjs') as CurrentRuntimeFixture : null;
export const migrationsDir = () => currentRuntimeFixture()?.stageFromEnvironment().migrations ?? join(projectRoot(), 'migrations');

/** Destructive reset, guarded three ways: test env, loopback host, database name ending in _test. */
function assertDisposable(config: AppConfig): void {
  const d = config.database;
  if (config.env !== 'test' || !isLoopbackHost(d.host) || !/_test$/.test(d.database)) {
    throw new Error('refusing to reset a database that is not a loopback *_test database in NODE_ENV=test');
  }
}

export async function resetSchema(config: AppConfig): Promise<Pool> {
  assertDisposable(config);
  const fixture = currentRuntimeFixture();
  fixture?.scope(config);
  const pool = createPool(config.database);
  if (fixture) await fixture.verifyDatabase(pool, config);
  await pool.query('DROP SCHEMA IF EXISTS hanq CASCADE');
  return pool;
}

/** Fresh schema + migrations + real catalog seed. Returns an admin pool for assertions. */
export async function freshDatabase(config: AppConfig): Promise<Pool> {
  const pool = await resetSchema(config);
  await migrate(pool, migrationsDir());
  await seedQuestions(pool, frontCatalog(), new Date('2026-10-01T00:00:00Z'));
  return pool;
}

export function sampleQuestions() {
  const all = frontCatalog();
  const quiz = all.filter((q) => q.kind === 'quiz');
  const mock = all.filter((q) => q.kind === 'mock');
  const wrongOf = (q: SeedQuestion) => q.optionIds.find((o) => o !== q.correctOptionId)!;
  return { all, quiz, mock, wrongOf };
}
