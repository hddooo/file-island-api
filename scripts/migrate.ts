import { join } from 'node:path';
import { loadDatabaseConfig } from '../src/config/config';
import { projectRoot } from '../src/common/project-root';
import { createPool } from '../src/db/db.service';
import { migrate } from '../src/db/migrator';

/** npm run migrate — uses DATABASE_URL (or HANQ_TEST_DATABASE_URL when NODE_ENV=test). Never prints connection details. */
async function main() {
  const { env, database } = loadDatabaseConfig(process.env);
  const pool = createPool(database);
  try {
    const r = await migrate(pool, join(projectRoot(), 'migrations'));
    console.log(`[migrate] ${env}: applied ${r.applied.length} (${r.applied.join(', ') || 'none'}), already applied ${r.alreadyApplied}; privileges re-applied`);
  } finally {
    await pool.end();
  }
}

main().catch((e: Error & { code?: string }) => {
  console.error(`[migrate] failed: ${e.name}${e.code ? ' code=' + e.code : ''}: ${e.name === 'ConfigError' || e.message.startsWith('migration ') ? e.message : 'see database logs'}`);
  process.exit(1);
});
