import type { INestApplication } from '@nestjs/common';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { projectRoot } from '../../src/common/project-root';
import { migrateOnStartup, safeReason, startServer, StartupError, type StartupSteps } from '../../src/startup';

/* Startup orchestration with injected fakes only: no database, no network, no listening socket. The real-database cases
   (fresh, 001–006 existing, latest, concurrent, failing new migration, checksum mismatch) are in
   test/integration/startup-migrations.test.ts for the coordinator's isolated *_test database. */
function fakeApp(log: string[], o: { closeFails?: boolean } = {}) {
  return { close: async () => { log.push('close'); if (o.closeFails) throw new Error('x'); } } as unknown as INestApplication;
}
function steps(log: string[], o: Partial<Record<'migrate' | 'createApp' | 'listen', Error>> = {}): StartupSteps {
  return {
    migrate: async () => { log.push('migrate'); if (o.migrate) throw o.migrate; return { applied: ['009_cbt_growth.sql'], alreadyApplied: 8 }; },
    createApp: async () => { log.push('createApp'); if (o.createApp) throw o.createApp; return fakeApp(log); },
    listen: async () => { log.push('listen'); if (o.listen) throw o.listen; },
    log: (line) => log.push('log:' + line),
  };
}
const SECRET = 'postgres://hanq_user:Sup3rSecret@db.internal.example:5432/hanq';

describe('server startup: migrations before the app and the listener', () => {
  it('order is migrate → createApp → listen, with a short secret-free migration summary', async () => {
    const log: string[] = [];
    await startServer(steps(log));
    assert.deepEqual(log, ['migrate', 'log:[migrate] applied 1 (009_cbt_growth.sql), already applied 8', 'createApp', 'listen']);
  });

  it('createApp does not start until the migration promise has settled', async () => {
    const log: string[] = [];
    let finish!: () => void;
    const s = steps(log);
    s.migrate = () => new Promise((r) => { log.push('migrate'); finish = () => r({ applied: [], alreadyApplied: 9 }); });
    const p = startServer(s);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log, ['migrate']);
    finish();
    await p;
    assert.deepEqual(log.slice(-2), ['createApp', 'listen']);
  });

  it('a failed migration prevents the app and the listener; the error is secret-free', async () => {
    const log: string[] = [];
    const pgError = Object.assign(new Error(`connect failed for ${SECRET} relation "hanq.users" value 'x'`), { code: '28P01' });
    await assert.rejects(startServer(steps(log, { migrate: pgError })), (e: unknown) => {
      assert.ok(e instanceof StartupError);
      assert.equal(e.phase, 'migration');
      assert.equal(e.message, 'migration failed: Error code=28P01');
      assert.ok(!/Sup3rSecret|hanq_user|db\.internal|hanq\.users/.test(e.message + e.reason));
      return true;
    });
    assert.deepEqual(log, ['migrate']);
  });

  it("the migrator's own checksum message (a file name only) is kept so operators can act", async () => {
    const log: string[] = [];
    await assert.rejects(startServer(steps(log, { migrate: new Error('migration 001_init.sql was changed after being applied') })),
      (e: unknown) => e instanceof StartupError && e.message === 'migration failed: Error: migration 001_init.sql was changed after being applied');
    assert.deepEqual(log, ['migrate']);
  });

  it('a failed app build never listens', async () => {
    const log: string[] = [];
    await assert.rejects(startServer(steps(log, { createApp: new TypeError('boom ' + SECRET) })), (e: unknown) => e instanceof StartupError && e.phase === 'app' && e.message === 'app failed: TypeError');
    assert.ok(!log.includes('listen'));
  });

  it('a failed listen closes the app (request pool) and reports without details', async () => {
    const log: string[] = [];
    const busy = Object.assign(new Error('listen EADDRINUSE: address already in use :::3001'), { code: 'EADDRINUSE' });
    await assert.rejects(startServer(steps(log, { listen: busy })), (e: unknown) => e instanceof StartupError && e.phase === 'listen' && e.message === 'listen failed: Error code=EADDRINUSE');
    assert.deepEqual(log.slice(-2), ['listen', 'close']);
  });

  it('migrateOnStartup always closes its own pool (success and failure) and uses the repository migrations folder', async () => {
    for (const fail of [false, true]) {
      const seen: string[] = [];
      const deps = {
        pool: () => ({ end: async () => { seen.push('end'); } }),
        run: async (_p: unknown, dir: string) => { seen.push('run:' + dir); if (fail) throw new Error('migration 002_wrong_note_study.sql was changed after being applied'); return { applied: [], alreadyApplied: 9 }; },
      };
      const p = migrateOnStartup({} as never, undefined, deps as never);
      if (fail) await assert.rejects(p); else assert.deepEqual(await p, { applied: [], alreadyApplied: 9 });
      assert.deepEqual(seen, ['run:' + join(projectRoot(), 'migrations'), 'end']);
    }
  });

  it('idle migration pool errors cannot escape as an unhandled driver error containing secrets', async () => {
    let closed = false;
    const pool = Object.assign(new EventEmitter(), { end: async () => { closed = true; } });
    const result = await migrateOnStartup({} as never, undefined, {
      pool: () => pool,
      run: async () => { pool.emit('error', new Error(SECRET)); return { applied: [], alreadyApplied: 9 }; },
    } as never);
    assert.deepEqual(result, { applied: [], alreadyApplied: 9 });
    assert.equal(closed, true);
  });

  it('safeReason drops anything that is not a class name, a short driver code or the migrator file message', () => {
    assert.equal(safeReason(Object.assign(new Error(SECRET), { code: 'ECONNREFUSED' })), 'Error code=ECONNREFUSED');
    assert.equal(safeReason(Object.assign(new Error('x'), { name: 'Evil name with spaces', code: 'bad code!' })), 'Error');
    assert.equal(safeReason('just a string with ' + SECRET), 'Error');
    assert.equal(safeReason(new Error('migration 001_init.sql was changed after being applied; ' + SECRET)), 'Error', 'only the exact migrator sentence is kept');
  });

  it('npm start / start:dev run main.ts, which migrates through runServer; the test helpers build the app without migrating', () => {
    const root = projectRoot();
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    assert.match(pkg.scripts.start, /dist\/src\/main\.js/);
    assert.match(pkg.scripts['start:dev'], /dist\/src\/main\.js/);
    const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    assert.match(main, /runServer\(config/);
    assert.doesNotMatch(main, /createApp\(/, 'main never builds the app before migrating');
    const boot = readFileSync(join(root, 'src', 'bootstrap.ts'), 'utf8'), helper = readFileSync(join(root, 'test', 'helpers', 'app.ts'), 'utf8');
    assert.doesNotMatch(boot, /migrat/i, 'createApp (used by tests) never migrates');
    assert.match(helper, /createApp\(/);
    assert.doesNotMatch(helper, /runServer|startServer|migrateOnStartup/);
  });
});
