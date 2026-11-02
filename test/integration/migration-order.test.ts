import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import { migrate } from '../../src/db/migrator';
import { migrationsDir, resetSchema } from '../helpers/db';
import { testConfig } from '../helpers/env';

/* Operator path (isolated *_test database only): 008 is applicable on its own after 001–006 while 007 is unapproved;
   009 needs 007 and 008 and fails cleanly (rolled back) without 007. */
describe('migration order: 008 standalone, 009 after 007 + 008', () => {
  let pool: Pool;
  const dir = mkdtempSync(join(tmpdir(), 'hanq-order-'));
  const add = (f: string) => copyFileSync(join(migrationsDir(), f), join(dir, f));
  const applied = async () => (await pool.query<{ version: string }>('SELECT version FROM hanq.schema_migrations ORDER BY version')).rows.map((r) => r.version);
  const column = async (name: string) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'hanq' AND table_name = 'growth_ledger' AND column_name = $1`, [name])).rowCount === 1;
  before(async () => {
    pool = await resetSchema(testConfig());
    mkdirSync(join(dir, 'repeatable'));
    cpSync(join(migrationsDir(), 'repeatable'), join(dir, 'repeatable'), { recursive: true });
    for (const f of ['001_init.sql', '002_wrong_note_study.sql', '003_growth_points.sql', '004_member_access.sql', '005_member_portal.sql', '006_test_premium_grants.sql']) add(f);
  });
  after(async () => {
    await pool.end();
  });

  it('008 applies after 006 without 007 and widens the ledger for practice rewards only', async () => {
    add('008_practice_growth.sql');
    const r = await migrate(pool, dir);
    assert.equal(r.applied.at(-1), '008_practice_growth.sql');
    assert.ok(!(await applied()).includes('007_authenticated_cbt.sql'));
    assert.equal((await pool.query(`SELECT to_regclass('hanq.cbt_runs') AS t`)).rows[0].t, null, 'no 007 object needed or created');
    assert.equal(await column('attempt_id'), true);
    const def = (await pool.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'growth_ledger_kind_valid'`)).rows[0].d;
    assert.match(def, /practice-quiz/);
    assert.doesNotMatch(def, /cbt-exam/);
  });

  it('009 without 007 fails and leaves nothing behind', async () => {
    add('009_cbt_growth.sql');
    await assert.rejects(migrate(pool, dir));
    assert.ok(!(await applied()).includes('009_cbt_growth.sql'));
    assert.equal(await column('cbt_run_id'), false);
  });

  it('with 007 present, 009 applies after 008', async () => {
    add('007_authenticated_cbt.sql');
    const r = await migrate(pool, dir);
    assert.deepEqual(r.applied, ['007_authenticated_cbt.sql', '009_cbt_growth.sql']);
    assert.equal(await column('cbt_run_id'), true);
  });
});
