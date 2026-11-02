import type { INestApplication } from '@nestjs/common';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { migrateOnStartup, startServer, StartupError, type MigrationResult } from '../../src/startup';
import { migrationsDir, resetSchema } from '../helpers/db';
import { testConfig } from '../helpers/env';

/* Startup = existing migrator, then the app, then the listener — against the coordinator's isolated *_test database only
   (helpers refuse anything else). Each case builds its own migrations folder copy so the repository files are never touched. */
describe('server startup applies pending migrations before serving (isolated *_test database)', () => {
  const config = testConfig();
  let pool: Pool;
  const ALL = readdirSync(migrationsDir()).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const dirWith = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'hanq-startup-'));
    mkdirSync(join(dir, 'repeatable'));
    cpSync(join(migrationsDir(), 'repeatable'), join(dir, 'repeatable'), { recursive: true });
    for (const f of files) copyFileSync(join(migrationsDir(), f), join(dir, f));
    return dir;
  };
  const applied = async () => (await pool.query<{ version: string }>('SELECT version FROM hanq.schema_migrations ORDER BY version')).rows.map((r) => r.version);
  const listenLog: string[] = [];
  const migrationResults: MigrationResult[] = [];
  const boot = (dir: string) => startServer({
    migrate: async () => { const result = await migrateOnStartup(config.database, dir); migrationResults.push(result); return result; },
    createApp: () => createApp(config),
    listen: async (app) => { listenLog.push('listen'); await app.listen(0, '127.0.0.1'); },
    log: () => undefined,
  });
  let running: INestApplication | null = null;
  before(async () => { pool = await resetSchema(config); });
  after(async () => { if (running) await running.close(); await pool.end(); });

  it('fresh database: every migration is applied before the first request is served', async () => {
    running = await boot(migrationsDir());
    assert.deepEqual(await applied(), ALL);
    assert.equal((await request(running.getHttpServer()).get('/api/v1/health')).status, 200);
    await running.close(); running = null;
  });

  it('existing 001–006 with data: only the pending files are applied, existing rows are kept', async () => {
    await pool.query('DROP SCHEMA IF EXISTS hanq CASCADE'); // isolated *_test database only (resetSchema guard above)
    const base = ALL.filter((f) => Number(f.slice(0, 3)) <= 6);
    assert.equal(base.length, 6);
    const early = await migrateOnStartup(config.database, dirWith(base));
    assert.deepEqual(early.applied, base);
    const id = randomUUID();
    await pool.query(`INSERT INTO hanq.users (id, email_normalized, email_display, password_hash, display_name, created_at, updated_at, password_changed_at) VALUES ($1, 'keep@example.test', 'keep@example.test', '$argon2id$fixture', 'keep', now(), now(), now())`, [id]);
    running = await boot(migrationsDir());
    assert.deepEqual(await applied(), ALL);
    assert.deepEqual(migrationResults.at(-1)?.applied, ALL.slice(6), 'only 007–009 applied');
    assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.users WHERE id = $1', [id])).rows[0].n, 1, 'existing data preserved');
    await running.close(); running = null;
  });

  it('already latest: nothing applied, server starts normally', async () => {
    const r = await migrateOnStartup(config.database, migrationsDir());
    assert.deepEqual([r.applied, r.alreadyApplied], [[], ALL.length]);
    running = await boot(migrationsDir());
    await running.close(); running = null;
  });

  it('concurrent instances on a fresh schema: the advisory lock applies each file exactly once', async () => {
    await pool.query('DROP SCHEMA IF EXISTS hanq CASCADE');
    const before = migrationResults.length;
    const servers = await Promise.allSettled([1, 2, 3].map(() => boot(migrationsDir())));
    try {
      assert.ok(servers.every(s => s.status === 'fulfilled'), 'all three instances start');
      assert.deepEqual(migrationResults.slice(before).flatMap(r => r.applied).sort(), ALL, 'each file applied by exactly one instance');
      assert.deepEqual(await applied(), ALL);
      for (const server of servers) if (server.status === 'fulfilled') {
        assert.equal((await request(server.value.getHttpServer()).get('/api/v1/health')).status, 200);
      }
    } finally {
      await Promise.all(servers.filter(s => s.status === 'fulfilled').map(s => s.status === 'fulfilled' ? s.value.close() : undefined));
    }
  });

  it('a failing new migration stops startup before the app or listener; nothing of it remains', async () => {
    const dir = dirWith(ALL);
    writeFileSync(join(dir, '999_broken.sql'), 'CREATE TABLE hanq.half_done (id int); SELECT * FROM hanq.does_not_exist;');
    const before = listenLog.length;
    await assert.rejects(boot(dir), (e: unknown) => e instanceof StartupError && e.phase === 'migration' && /^migration failed: \w+ code=42P01$/.test(e.message));
    assert.equal(listenLog.length, before, 'never listened');
    assert.equal((await pool.query(`SELECT to_regclass('hanq.half_done') t`)).rows[0].t, null);
    assert.deepEqual(await applied(), ALL);
  });

  it('a changed applied migration (checksum mismatch) stops startup with the file name only', async () => {
    const dir = dirWith(ALL);
    appendFileSync(join(dir, '001_init.sql'), '\n-- edited\n');
    await assert.rejects(boot(dir), (e: unknown) => e instanceof StartupError && e.message === 'migration failed: Error: migration 001_init.sql was changed after being applied');
    assert.deepEqual(await applied(), ALL, 'history not rewritten');
  });
});
