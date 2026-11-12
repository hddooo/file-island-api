import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DbService} from '../../src/db/db.service';
import {projectRoot} from '../../src/common/project-root';
import {artifactHash} from '../../src/textbook/private-script-artifact';
import {migratePrivateScriptArtifacts,importPrivateStructure} from '../../src/db/private-script-artifact-import';
import {testConfig} from '../helpers/env';
import {resetSchema} from '../helpers/db';
import {syntheticArtifact} from '../helpers/private-script-artifact';

test('targeted private DB migration/import: no permission SQL, no existing edits, rerun/race/conflict safety',async()=>{
 if (process.env.HANQ_QUAL_QUALIFICATION_PROFILE === 'schema61-local-private-retained-base') { const reset=await resetSchema(testConfig()); await reset.end(); }
 const db=new DbService(testConfig());
 try{
  // New isolated test DB only. Minimal prior ledger plus sentinel; never execute general migrator.
  await db.pool.query('CREATE SCHEMA hanq');
  await db.pool.query('CREATE TABLE hanq.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  await db.pool.query("CREATE TABLE hanq.test_existing_progress(id integer PRIMARY KEY, value text); INSERT INTO hanq.test_existing_progress VALUES(1,'unchanged')");
  const dir=join(projectRoot(),'migrations');
  for(const file of readdirSync(dir).filter(f=>/^\d{3}_[a-z0-9_]+\.sql$/.test(f)))await db.pool.query('INSERT INTO hanq.schema_migrations(version,checksum) VALUES($1,$2)',[file,artifactHash(Buffer.from(readFileSync(join(dir,file),'utf8').replace(/\r\n/g,'\n')))]);
  const acl=async()=>JSON.stringify((await db.pool.query("SELECT nspacl FROM pg_namespace WHERE nspname='hanq'")).rows);
  const before=await acl();assert.equal(await migratePrivateScriptArtifacts(db.pool),true);assert.equal(await migratePrivateScriptArtifacts(db.pool),false);assert.equal(await acl(),before);
  const f=syntheticArtifact();
  const races=await Promise.all([importPrivateStructure(db.pool,f.identity,f.payload,f.bundle),importPrivateStructure(db.pool,f.identity,f.payload,f.bundle)]);
  assert.deepEqual(races.sort(),[false,true]);
  assert.equal(await importPrivateStructure(db.pool,f.identity,f.payload,f.bundle),false);
  assert.equal(await importPrivateStructure(db.pool,f.configIdentity,f.config,f.bundle,f.quiz),true);
  const changed=JSON.parse(f.payload.toString());changed.bundleDescriptor.syntheticExtra=true;const bytes=Buffer.from(JSON.stringify(changed));
  await assert.rejects(importPrivateStructure(db.pool,{...f.identity,byteLength:bytes.length,contentSha256:artifactHash(bytes)},bytes,f.bundle),/immutable_artifact_conflict/);
  await assert.rejects(importPrivateStructure(db.pool,f.identity,Buffer.from('tampered'),f.bundle));
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM hanq.private_script_artifacts')).rows[0].n,2);
  assert.equal((await db.pool.query('SELECT value FROM hanq.test_existing_progress WHERE id=1')).rows[0].value,'unchanged');
  assert.equal(await acl(),before);
 }finally{await db.onModuleDestroy();}
});
