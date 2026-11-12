import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname} from 'node:path';
import {migrate} from '../../src/db/migrator';
import {seedQuestions} from '../../src/questions/question-seeder';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after,before,it } from 'node:test';
import type { Pool } from 'pg';
import { projectRoot } from '../../src/common/project-root';
import { UsersRepository } from '../../src/auth/users.repository';
import { PasswordService } from '../../src/auth/password.service';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { PASSWORD,uniqueEmail } from '../helpers/app';
import { freshDatabase,sampleQuestions,resetSchema,migrationsDir,frontCatalog } from '../helpers/db';
import { testConfig,testEnv } from '../helpers/env';
let pool:Pool;
before(async()=>{pool=await freshDatabase(testConfig());});after(async()=>{await pool.end();});
it('read-only command reports pass, legacy negative aggregate and unavailable without IDs or credentials',async()=>{
 const run=(overrides:Record<string,string>={})=>spawnSync(process.execPath,[join(projectRoot(),'dist/scripts/check-growth-floor.js')],{env:{...process.env,...testEnv(overrides)},encoding:'utf8'});
 let r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).negativeBalances,'0');
 if(process.env.HANQ_QUAL_QUALIFICATION_PROFILE==='schema61-local-private-retained-base'){
  const source=migrationsDir(),parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'hanq-pre015-fixture-'));
  const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
  const reviewed=JSON.parse(readFileSync(join(source,'../test/fixtures/migration-manifest-20261030.json'),'utf8')) as {migrations:{version:string;checksum:string}[];privilegesSha256:string};
  const names=['001_init.sql','002_wrong_note_study.sql','003_growth_points.sql','004_member_access.sql','005_member_portal.sql','006_test_premium_grants.sql','007_authenticated_cbt.sql','008_practice_growth.sql','009_cbt_growth.sql','010_manual_wrong_notes.sql','011_comprehensive_note_practice.sql','012_personal_review_profiles.sql','013_cbt_batch_pause.sql','014_cbt_pause_checkpoint.sql'];
  let phaseStarted=false;
  try{
   assert.equal(reviewed.migrations.length,61);assert.equal(digest(JSON.stringify(reviewed.migrations)),'c27f38853d20daa55a8b2e4047515b5efec43a79c7ed2feae563218aba34c8d8');
   const selected=reviewed.migrations.filter(row=>Number(row.version.slice(0,3))<=14);assert.deepEqual(selected.map(row=>row.version),names);
   mkdirSync(join(directory,'repeatable'));
   for(const row of selected){const bytes=readFileSync(join(source,row.version));assert.equal(digest(bytes),row.checksum);writeFileSync(join(directory,row.version),bytes,{flag:'wx',mode:0o444});}
   const privileges=readFileSync(join(source,'repeatable/privileges.sql'));assert.equal(reviewed.privilegesSha256,'9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0');assert.equal(digest(privileges),reviewed.privilegesSha256);writeFileSync(join(directory,'repeatable/privileges.sql'),privileges,{flag:'wx',mode:0o444});
   // Phase boundary: the same host-owned UUID DB is reset, never the currently guarded61 schema weakened in place.
   await pool.end();pool=await resetSchema(testConfig());phaseStarted=true;
   assert.deepEqual((await migrate(pool,directory)).applied,names);
   assert.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,selected);
   await seedQuestions(pool,frontCatalog(),new Date('2026-10-01T00:00:00Z'));
   const id=randomUUID(),email=uniqueEmail(),now=new Date();await new UsersRepository().insert(pool,{id,emailNormalized:email.toLowerCase(),emailDisplay:email,passwordHash:await new PasswordService().hash(PASSWORD),displayName:'legacy fixture',now});
   const question=sampleQuestions().mock[0],attempt=randomUUID();await new AttemptsRepository().insert(pool,{id:attempt,userId:id,submissionId:randomUUID(),questionId:question.questionId,version:question.version,optionId:question.optionIds.find(option=>option!==question.correctOptionId)!,correct:false,source:'practice',payloadHash:Buffer.alloc(32),now});
   await pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at)VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now())",[id,attempt]);
   const before=JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows);
   r=run();assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).negativeBalances,'1');assert.equal(JSON.parse(r.stdout).status,'reconciliation-required');
   assert.equal(JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows),before,'read-only check cannot reconcile or rewrite history');assert.ok(!r.stdout.includes(id)&&!r.stdout.includes(email)&&!r.stdout.includes(PASSWORD)&&!r.stdout.includes('postgres://'));
   r=run({HANQ_TEST_DATABASE_URL:'invalid'});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).status,'unavailable');
  }finally{
   try{if(phaseStarted){await pool.end();pool=await resetSchema(testConfig());await migrate(pool,source);assert.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,reviewed.migrations);}}
   finally{assert.equal(dirname(directory),parent);rmSync(directory,{recursive:true,force:true});assert.equal(existsSync(directory),false);}
  }
  return;
 }
 // Owned *_test fixture only: simulate a ledger made by a pre015 server. No operating connection or migration action.
 await pool.query('DROP TRIGGER growth_floor ON hanq.growth_ledger');
 const id=randomUUID(),email=uniqueEmail(),now=new Date();await new UsersRepository().insert(pool,{id,emailNormalized:email.toLowerCase(),emailDisplay:email,passwordHash:await new PasswordService().hash(PASSWORD),displayName:'legacy fixture',now});const q=sampleQuestions().mock[0],attempt=randomUUID();await new AttemptsRepository().insert(pool,{id:attempt,userId:id,submissionId:randomUUID(),questionId:q.questionId,version:q.version,optionId:q.optionIds.find(o=>o!==q.correctOptionId)!,correct:false,source:'practice',payloadHash:Buffer.alloc(32),now});await pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at)VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now())",[id,attempt]);
 const before=JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows);r=run();assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).negativeBalances,'1');assert.equal(JSON.parse(r.stdout).status,'reconciliation-required');assert.equal(JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows),before,'read-only check cannot reconcile or rewrite history');assert.ok(!r.stdout.includes(id)&&!r.stdout.includes(email)&&!r.stdout.includes(PASSWORD)&&!r.stdout.includes('postgres://'));
 r=run({HANQ_TEST_DATABASE_URL:'invalid'});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).status,'unavailable');
});
