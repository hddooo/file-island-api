import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbService } from '../../src/db/db.service';
import { migrate } from '../../src/db/migrator';
import { projectRoot } from '../../src/common/project-root';
import { TextbookService } from '../../src/textbook/textbook.service';
import { SourceBlankProgressService } from '../../src/textbook/source-blank-progress';
import { testConfig } from '../helpers/env';
import { signup, startApp } from '../helpers/app';
import { OLD_PDF_SHA, syntheticSemanticBundle, writeSyntheticBundle } from '../helpers/semantic-source-fixture';

test('real synthetic PG: source revisions preserve old/new progress, workspace, grading and retries without XP or exam writes', async () => {
 const repository = await mkdtemp(join(tmpdir(), 'semantic-revisions-test-'));
 const config = testConfig(), db = new DbService(config);
 let app: Awaited<ReturnType<typeof startApp>> | undefined;
 try {
  await migrate(db.pool, join(projectRoot(), 'migrations'));
  app = await startApp();
  const a = await signup(app), b = await signup(app);
  const service = new SourceBlankProgressService(db, new TextbookService(config, repository));
  const old = syntheticSemanticBundle(OLD_PDF_SHA, 144), next = syntheticSemanticBundle();
  // Snapshot every other table byte-for-byte (including XP, attempts and history), not just counts.
  const tables = (await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='hanq' AND tablename NOT IN ('source_blank_progress','source_blank_workspaces') ORDER BY tablename")).rows.map(row => row.tablename as string);
  const untouched = async () => {
   const hashes: Record<string, string> = {};
   for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    const rows = (await db.pool.query(`SELECT to_jsonb(t) AS row FROM hanq.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
   }
   return hashes;
  };
  const before = await untouched();
  const rows = async () => (await db.pool.query('SELECT source_version,revision,progress,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_progress WHERE user_id=$1 ORDER BY source_version', [a.userId])).rows;
  const workspaces = async () => (await db.pool.query('SELECT source_version,revision,workspace,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 ORDER BY source_version', [a.userId])).rows;
  await writeSyntheticBundle(repository, old);
  const initial = await service.get(a.userId, 'prehistory');
  const answer = {version: initial.version, revision: 0, mutationId: randomUUID(), position: 0, values: ['SYNTHETIC A'], action: 'answer' as const};
  await service.save(a.userId, 'prehistory', answer);
  const pause = {...answer, revision: 1, mutationId: randomUUID(), position: 1, values: ['SYNTHETIC DRAFT'], action: 'pause' as const};
  const oldProgress = await service.save(a.userId, 'prehistory', pause);
  assert.equal(oldProgress.progress.responses[0].correct, true);
  const oldBatch = {version: initial.version, revision: 0, mutationId: randomUUID(), cursor: 2, status: 'paused' as const, updates: [{itemId: old.quiz.items[0].id, values: ['SYNTHETIC WRONG'], submitted: true}]};
  const oldWorkspace = await service.saveWorkspace(a.userId, 'prehistory', oldBatch);
  assert.equal(oldWorkspace.workspace.responses[old.quiz.items[0].id].correct, false);
  assert.deepEqual(await service.saveWorkspace(a.userId, 'prehistory', oldBatch), oldWorkspace);
  const oldRows = await rows(), oldWorkspaces = await workspaces();
  await writeSyntheticBundle(repository, next);
  const nextInitial = await service.get(a.userId, 'prehistory');
  assert.notEqual(nextInitial.version, initial.version);
  assert.equal(nextInitial.revision, 0); assert.deepEqual(nextInitial.progress.responses, []);
  assert.deepEqual((await service.getWorkspace(a.userId, 'prehistory')).workspace.responses, {});
  // Even an exact old successful retry is stale against the current source and writes nothing.
  await assert.rejects(service.save(a.userId, 'prehistory', pause), {status: 400});
  await assert.rejects(service.saveWorkspace(a.userId, 'prehistory', oldBatch), {status: 400});
  assert.deepEqual(await rows(), oldRows); assert.deepEqual(await workspaces(), oldWorkspaces);
  const nextAnswer = {...answer, version: nextInitial.version, mutationId: randomUUID(), values: ['SYNTHETIC WRONG']};
  const nextProgress = await service.save(a.userId, 'prehistory', nextAnswer);
  assert.equal(nextProgress.progress.responses[0].correct, false);
  assert.deepEqual(await service.save(a.userId, 'prehistory', nextAnswer), nextProgress);
  const nextBatch = {...oldBatch, version: nextInitial.version, mutationId: randomUUID(), cursor: 3, updates: [{itemId: next.quiz.items[0].id, values: ['SYNTHETIC A'], submitted: true}]};
  const nextWorkspace = await service.saveWorkspace(a.userId, 'prehistory', nextBatch);
  assert.equal(nextWorkspace.workspace.responses[next.quiz.items[0].id].correct, true);
  assert.deepEqual(await service.saveWorkspace(a.userId, 'prehistory', nextBatch), nextWorkspace);
  assert.deepEqual((await service.getWorkspace(b.userId, 'prehistory')).workspace.responses, {});
  assert.equal((await rows()).length, 2); assert.equal((await workspaces()).length, 2);
  await writeSyntheticBundle(repository, old);
  assert.deepEqual(await service.get(a.userId, 'prehistory'), oldProgress);
  assert.deepEqual(await service.getWorkspace(a.userId, 'prehistory'), oldWorkspace);
  assert.deepEqual(await service.save(a.userId, 'prehistory', pause), oldProgress);
  assert.deepEqual(await service.saveWorkspace(a.userId, 'prehistory', oldBatch), oldWorkspace);
  await writeSyntheticBundle(repository, next);
  assert.deepEqual(await service.get(a.userId, 'prehistory'), nextProgress);
  assert.deepEqual(await service.getWorkspace(a.userId, 'prehistory'), nextWorkspace);
  assert.deepEqual(await untouched(), before);
 } finally {
  if (app) await app.close();
  await db.onModuleDestroy();
  await rm(repository, {recursive: true, force: true});
 }
});
