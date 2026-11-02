import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { cpSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import { migrate } from '../../src/db/migrator';
import { seedQuestions } from '../../src/questions/question-seeder';
import { frontCatalog, migrationsDir, resetSchema } from '../helpers/db';
import { testConfig } from '../helpers/env';

// Independent reviewed oracle: adding/removing/editing a file under test must not
// silently change expectations. Deliberately update this fixture for a new release.
const expected = JSON.parse(readFileSync(join(migrationsDir(),'../test/fixtures/migration-manifest-20261030.json'),'utf8')) as {
  migrations:{version:string;checksum:string}[];privilegesSha256:string;
};
const versions = expected.migrations.map(row=>row.version);
function assertReviewedFiles(){
  const actual = readdirSync(migrationsDir()).filter(name=>/^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.deepEqual(actual,versions,'exact reviewed numbered files, no omissions or unexpected additions');
  for(const row of expected.migrations)assert.equal(createHash('sha256').update(readFileSync(join(migrationsDir(),row.version))).digest('hex'),row.checksum,row.version);
  assert.equal(createHash('sha256').update(readFileSync(join(migrationsDir(),'repeatable/privileges.sql'))).digest('hex'),expected.privilegesSha256);
}

describe('migrations and seed (isolated *_test database)', () => {
  let pool: Pool;
  before(async () => {
    pool = await resetSchema(testConfig());
  });
  after(async () => {
    await pool.end();
  });

  it('fresh migrate creates schema hanq and applies the exact reviewed file/checksum manifest', async () => {
    assertReviewedFiles();
    // Worst case first: hanq already exists (e.g. created by hand) with PUBLIC usage AND a default privilege that would
    // give PUBLIC SELECT on every new table. The migrator must close both inside the same transactions that create tables.
    await pool.query('CREATE SCHEMA hanq');
    await pool.query('GRANT USAGE, CREATE ON SCHEMA hanq TO PUBLIC');
    await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA hanq GRANT SELECT ON TABLES TO PUBLIC');
    const r = await migrate(pool, migrationsDir());
    const u = await pool.query<{ s: boolean; c: boolean; t: boolean; m: boolean }>(
      `SELECT has_schema_privilege('public', 'hanq', 'USAGE') AS s, has_schema_privilege('public', 'hanq', 'CREATE') AS c,
              has_table_privilege('public', 'hanq.users', 'SELECT') AS t, has_table_privilege('public', 'hanq.schema_migrations', 'SELECT') AS m`,
    );
    assert.deepEqual(u.rows[0], { s: false, c: false, t: false, m: false });
    const anyPublicTable = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'hanq' AND c.relkind IN ('r', 'S') AND has_table_privilege('public', c.oid, 'SELECT')`,
    );
    assert.deepEqual(anyPublicTable.rows, [], 'no hanq table or sequence readable by PUBLIC');
    const defaults = await pool.query(`SELECT d.defaclacl::text AS acl FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'hanq'`);
    assert.ok(defaults.rows.every((x: { acl: string }) => !/(^|[{,])=/.test(x.acl)), 'no per-schema default grant to PUBLIC remains');
    assert.deepEqual(r.applied, versions);
    assert.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,expected.migrations);
    const s = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'hanq'`);
    assert.equal(s.rowCount, 1);
    const t = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'hanq' ORDER BY 1`);
    for (const name of ['users', 'session_families', 'refresh_tokens', 'question_versions', 'attempts', 'entitlement_ledger', 'payment_orders', 'payments', 'schema_migrations', 'cbt_runs', 'cbt_run_items','manual_wrong_notes']) {
      assert.ok(t.rows.some((r) => r.table_name === name), name);
    }
    const leaked = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','attempts','question_versions','payments')`);
    assert.equal(leaked.rowCount, 0, 'nothing is created in public');
  });

  it('re-running is a no-op', async () => {
    const before = (await pool.query('SELECT version,checksum,applied_at::text FROM hanq.schema_migrations ORDER BY version')).rows;
    const r = await migrate(pool, migrationsDir());
    assert.deepEqual(r.applied, []);
    assert.equal(r.alreadyApplied, expected.migrations.length);
    assert.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,expected.migrations);
    assert.deepEqual((await pool.query('SELECT version,checksum,applied_at::text FROM hanq.schema_migrations ORDER BY version')).rows,before,'rerun never rewrites checksums or applied timestamps');
  });

  it('refuses an applied migration whose content changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hanq-mig-'));
    cpSync(migrationsDir(), dir, { recursive: true });
    appendFileSync(join(dir, '001_init.sql'), '\n-- edited\n');
    await assert.rejects(migrate(pool, dir), /changed after being applied/);
  });

  it('a failing new migration rolls back completely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hanq-mig-'));
    cpSync(migrationsDir(), dir, { recursive: true });
    writeFileSync(join(dir, '002_broken.sql'), 'CREATE TABLE hanq.half_done (id int); SELECT * FROM hanq.does_not_exist;');
    await assert.rejects(migrate(pool, dir));
    const t = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'hanq' AND table_name = 'half_done'`);
    assert.equal(t.rowCount, 0);
  });

  it('PUBLIC and Supabase API roles (if present) get no access to schema hanq', async () => {
    // Local container only: simulate Supabase's API roles to prove the repeatable privileges file revokes them.
    for (const r of ['anon', 'authenticated']) {
      await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$`);
      await pool.query(`GRANT USAGE ON SCHEMA hanq TO ${r}`);
      await pool.query(`GRANT SELECT ON hanq.users TO ${r}`);
    }
    await migrate(pool, migrationsDir());
    for (const r of ['anon', 'authenticated', 'public']) {
      const q = await pool.query<{ u: boolean }>(`SELECT has_schema_privilege($1, 'hanq', 'USAGE') AS u`, [r]);
      assert.equal(q.rows[0].u, false, `${r} must not use schema hanq`);
    }
    for (const r of ['anon', 'authenticated']) {
      const q = await pool.query<{ s: boolean }>(`SELECT has_table_privilege($1, 'hanq.users', 'SELECT') AS s`, [r]);
      assert.equal(q.rows[0].s, false);
    }
  });

  it('entitlement ledger is append-only at the database level', async () => {
    const u = randomUUID(), o = randomUUID(), p = randomUUID(), now = new Date('2026-10-08T00:00:00Z');
    await pool.query(`INSERT INTO hanq.users (id, email_normalized, email_display, password_hash, display_name, created_at, updated_at, password_changed_at)
                      VALUES ($1, $2, $2, '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'x', $3, $3, $3)`, [u, `ledger-${u}@example.test`, now]);
    await pool.query(`INSERT INTO hanq.payment_orders (id, user_id, order_ref, plan_id, amount, currency, provider, status, created_at, updated_at, paid_at)
                      VALUES ($1, $2, $3, 'premium-1m', 5000, 'KRW', 'test', 'paid', $4, $4, $4)`, [o, u, 'hq_' + 'A'.repeat(24), now]);
    await pool.query(`INSERT INTO hanq.payments (id, order_id, provider, provider_payment_id, amount, currency, verified_at) VALUES ($1, $2, 'test', 'test_ledger', 5000, 'KRW', $3)`, [p, o, now]);
    await pool.query(`INSERT INTO hanq.entitlement_ledger (id, user_id, payment_id, plan_id, period_policy, granted_from, granted_until, created_at)
                      VALUES ($1, $2, $3, 'premium-1m', 'calendar-month', $4, $5, $4)`, [randomUUID(), u, p, now, new Date('2026-11-08T00:00:00Z')]);
    await assert.rejects(pool.query('UPDATE hanq.entitlement_ledger SET plan_id = plan_id'), /append-only/);
    await assert.rejects(pool.query('DELETE FROM hanq.entitlement_ledger'), /append-only/);
    // a second grant for the same payment is impossible
    await assert.rejects(pool.query(`INSERT INTO hanq.entitlement_ledger (id, user_id, payment_id, plan_id, period_policy, granted_from, granted_until, created_at)
                      VALUES ($1, $2, $3, 'premium-1m', 'calendar-month', $4, $5, $4)`, [randomUUID(), u, p, now, new Date('2026-12-08T00:00:00Z')]), /duplicate key/);
  });

  it('seed loads the real catalog and is idempotent', async () => {
    const items = frontCatalog();
    const first = await seedQuestions(pool, items, new Date('2026-10-01T00:00:00Z'));
    assert.equal(first.total, frontCatalog().length);
    assert.equal(first.inserted, frontCatalog().length);
    const again = await seedQuestions(pool, items, new Date('2026-10-02T00:00:00Z'));
    assert.equal(again.inserted, 0);
    assert.equal(again.promoted, 0);
    assert.equal(again.retired, 0);
    const c = await pool.query<{ kind: string; n: string }>(`SELECT kind, count(*)::text n FROM hanq.question_versions WHERE is_current GROUP BY kind ORDER BY kind`);
    assert.deepEqual(c.rows.map((r) => [r.kind, Number(r.n)]), [['mock', 500], ['quiz', frontCatalog().filter(q=>q.kind==='quiz').length]]);
  });

  it('stored public payloads carry no answers (database-level check)', async () => {
    const leak = await pool.query(
      `SELECT question_id FROM hanq.question_versions
        WHERE public_payload ?| array['answer','a','compound','why','cue','overview','legacy','sources','source','kind']
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(public_payload->'options') o WHERE o ?| array['correct','review','number'])`,
    );
    assert.deepEqual(leak.rows, []);
  });

  it('re-derives a public payload when only the derivation changed (same source content)', async () => {
    const one = frontCatalog().find((q) => q.kind === 'quiz')!;
    await pool.query(`UPDATE hanq.question_versions SET public_payload = public_payload || '{"compound":{"x":1}}' WHERE question_id = $1 AND version = $2`, [one.questionId, one.version]);
    const r = await seedQuestions(pool, frontCatalog(), new Date());
    assert.equal(r.rederivedPublic, 1);
    const row = await pool.query(`SELECT public_payload ? 'compound' AS has FROM hanq.question_versions WHERE question_id = $1 AND version = $2`, [one.questionId, one.version]);
    assert.equal(row.rows[0].has, false);
  });

  it('refuses changed content under an existing version, and changes nothing', async () => {
    const items = frontCatalog().map((q) => ({ ...q }));
    items[0] = { ...items[0], contentHash: 'f'.repeat(64) };
    await assert.rejects(seedQuestions(pool, items, new Date()), /content changed without a new version/);
    const c = await pool.query(`SELECT count(*)::int n FROM hanq.question_versions`);
    assert.equal(c.rows[0].n, frontCatalog().length);
  });

  it('a new version becomes current and the old one stays for history', async () => {
    const items = frontCatalog().map((q) => ({ ...q }));
    const i = items.findIndex((q) => q.kind === 'mock');
    items[i] = { ...items[i], version: items[i].version + '-v2', contentHash: 'e'.repeat(64) };
    const r = await seedQuestions(pool, items, new Date());
    assert.equal(r.inserted, 1);
    assert.equal(r.promoted, 1);
    assert.equal(r.retired, 1);
    const rows = await pool.query<{ version: string; is_current: boolean }>(`SELECT version, is_current FROM hanq.question_versions WHERE question_id = $1 ORDER BY version`, [items[i].questionId]);
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.filter((x) => x.is_current).length, 1);
    // restore the real catalog as current for later files (each file resets anyway)
    await seedQuestions(pool, frontCatalog(), new Date());
  });
});
