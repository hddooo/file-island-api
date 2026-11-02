import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { sha256hex } from '../common/util';

export const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;

async function inTx(client: PoolClient, fn: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await fn();
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** Applies migrations/NNN_*.sql in order with a recorded checksum. Re-running is a no-op; an applied file whose content
 *  changed is an error (write a new migration instead). A session advisory lock prevents two concurrent runs.
 *
 *  Privilege timing: the repeatable privileges file (revoke PUBLIC/anon/authenticated on hanq) runs
 *   1. right after `CREATE SCHEMA IF NOT EXISTS hanq`, in the same transaction, BEFORE any table exists — so a
 *      pre-existing hanq schema that had PUBLIC usage is closed first;
 *   2. inside EVERY migration transaction, after its DDL and before COMMIT — new tables are never visible to other
 *      sessions with broader privileges, not even for an instant;
 *   3. once more at the end (idempotent). */
export async function migrate(pool: Pool, dir: string): Promise<{ applied: string[]; alreadyApplied: number }> {
  const files = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f)).sort();
  const privileges = readFileSync(join(dir, 'repeatable', 'privileges.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('hanq.migrate'))`);
    await inTx(client, async () => {
      await client.query('CREATE SCHEMA IF NOT EXISTS hanq');
      await client.query(privileges);
      await client.query(`CREATE TABLE IF NOT EXISTS hanq.schema_migrations (
        version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(privileges);
    });
    const done = new Map((await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM hanq.schema_migrations')).rows.map((r) => [r.version, r.checksum]));
    const applied: string[] = [];
    let alreadyApplied = 0;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const sum = sha256hex(sql);
      const prev = done.get(f);
      if (prev) {
        if (prev !== sum) throw new Error(`migration ${f} was changed after being applied`);
        alreadyApplied++;
        continue;
      }
      await inTx(client, async () => {
        await client.query(sql);
        await client.query(privileges);
        await client.query('INSERT INTO hanq.schema_migrations (version, checksum) VALUES ($1, $2)', [f, sum]);
      });
      applied.push(f);
    }
    await inTx(client, async () => {
      await client.query(privileges);
    });
    return { applied, alreadyApplied };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('hanq.migrate'))`).catch(() => undefined);
    client.release();
  }
}
