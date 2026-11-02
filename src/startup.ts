import type { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createApp } from './bootstrap';
import { projectRoot } from './common/project-root';
import type { AppConfig } from './config/config';
import { createPool } from './db/db.service';
import { migrate } from './db/migrator';

/** Server startup policy (npm start / npm run start:dev → dist/src/main.js → runServer):
 *   1. apply versioned, not-yet-applied migrations from migrations/NNN_*.sql with the existing migrator (recorded checksums in
 *      hanq.schema_migrations, one transaction per file, session advisory lock so concurrent instances apply each file once,
 *      repeatable privileges file that only revokes), using a short-lived pool that is always closed;
 *   2. only then build the Nest app (which opens the request pool);
 *   3. only then listen. Any failure stops startup before a single request is served — never a half-migrated server
 *      answering 503 schema_not_ready. Nothing here drops, resets, seeds or backfills data, and applied migrations are never
 *      rewritten (a changed applied file is refused by the migrator's checksum check).
 *  The integration test helpers call bootstrap.createApp directly and never run this. */

export type MigrationResult = { applied: string[]; alreadyApplied: number };

export class StartupError extends Error {
  constructor(readonly phase: 'migration' | 'app' | 'listen', readonly reason: string) {
    super(`${phase} failed: ${reason}`);
    this.name = 'StartupError';
  }
}

/** A reason that is safe to print: error class + driver code only. Database/driver messages can carry hosts, users, SQL text
 *  or values, so they are never echoed — except the migrator's own messages, which only name a migration file. */
export function safeReason(e: unknown): string {
  const err = e as { name?: unknown; code?: unknown; message?: unknown } | null;
  const name = typeof err?.name === 'string' && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : 'Error';
  const code = typeof err?.code === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(err.code) ? ` code=${err.code}` : '';
  const msg = typeof err?.message === 'string' ? err.message : '';
  const own = /^migration \d{3}_[a-z0-9_]+\.sql was changed after being applied$/.exec(msg);
  return `${name}${code}${own ? ': ' + own[0] : ''}`;
}

/** Runs the existing migrator on its own pool and always closes that pool (success or failure). */
export async function migrateOnStartup(
  database: AppConfig['database'],
  dir = join(projectRoot(), 'migrations'),
  deps: { pool?: (cfg: AppConfig['database']) => Pick<Pool, 'end'> & Partial<Pick<Pool, 'on'>>; run?: (pool: Pool, dir: string) => Promise<MigrationResult> } = {},
): Promise<MigrationResult> {
  const pool = (deps.pool ?? createPool)(database);
  // Idle pool errors must not escape through EventEmitter and print a raw driver stack. Query failures are caught below.
  pool.on?.('error', () => undefined);
  try {
    return await (deps.run ?? migrate)(pool as Pool, dir);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export interface StartupSteps {
  migrate: () => Promise<MigrationResult>;
  createApp: () => Promise<INestApplication>;
  listen: (app: INestApplication) => Promise<unknown>;
  log: (line: string) => void;
}

/** Strict order: migrate → createApp → listen. A failed listen closes the app (and with it the request pool). */
export async function startServer(steps: StartupSteps): Promise<INestApplication> {
  let r: MigrationResult;
  try {
    r = await steps.migrate();
  } catch (e) {
    throw new StartupError('migration', safeReason(e));
  }
  steps.log(`[migrate] applied ${r.applied.length} (${r.applied.join(', ') || 'none'}), already applied ${r.alreadyApplied}`);
  let app: INestApplication;
  try {
    app = await steps.createApp();
  } catch (e) {
    throw new StartupError('app', safeReason(e));
  }
  try {
    await steps.listen(app);
  } catch (e) {
    await app.close().catch(() => undefined);
    throw new StartupError('listen', safeReason(e));
  }
  return app;
}

/** The production wiring used by main.ts. */
export function runServer(config: AppConfig, log: (line: string) => void): Promise<INestApplication> {
  return startServer({
    migrate: () => migrateOnStartup(config.database),
    createApp: () => createApp(config),
    listen: (app) => app.listen(config.port),
    log,
  });
}
