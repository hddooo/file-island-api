import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync,mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after,before,it } from 'node:test';
import type { Pool } from 'pg';
import { projectRoot } from '../../src/common/project-root';
import { UsersRepository } from '../../src/auth/users.repository';
import { PasswordService } from '../../src/auth/password.service';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { PASSWORD,uniqueEmail } from '../helpers/app';
import { freshDatabase,migrationsDir } from '../helpers/db';
import { testConfig,testEnv } from '../helpers/env';
import { createPool } from '../../src/db/db.service';
import { migrate } from '../../src/db/migrator';
let pool:Pool;
before(async()=>{pool=await freshDatabase(testConfig());});after(async()=>{await pool.end();});
it('read-only command reports pass, legacy negative aggregate and unavailable without IDs or credentials',async()=>{
 const run=(overrides:Record<string,string>={})=>spawnSync(process.execPath,[join(projectRoot(),'dist/scripts/check-growth-floor.js')],{env:{...process.env,...testEnv(overrides)},encoding:'utf8'});
 let r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).negativeBalances,'0');
 // A real separate pre015 database exposes committed synthetic legacy data to the CLI.
 // The full-schema database's floor and equipped-XP guards remain enabled throughout.
 const config=testConfig(),url=new URL(testEnv().HANQ_TEST_DATABASE_URL),legacyName='hanq_legacy_'+randomUUID().replace(/-/g,'')+'_test';
 assert.equal(config.env,'test');assert(['127.0.0.1','localhost','::1'].includes(config.database.host));assert(config.database.database.endsWith('_test'));assert(/^hanq_legacy_[a-f0-9]{32}_test$/.test(legacyName));
 const dir=mkdtempSync(join(tmpdir(),'hanq-pre015-')),legacy=createPool({...config.database,database:legacyName});let created=false;
 const fullBefore=JSON.stringify((await pool.query("SELECT version,checksum FROM hanq.schema_migrations ORDER BY version")).rows);
 const guards=async()=>JSON.stringify((await pool.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='hanq.growth_ledger'::regclass AND tgname IN('growth_floor','growth_apply_digimon') ORDER BY tgname")).rows),guardsBefore=await guards();
 assert.equal(guardsBefore,JSON.stringify([{tgname:'growth_apply_digimon',tgenabled:'O'},{tgname:'growth_floor',tgenabled:'O'}]));
 try{
  await pool.query(`CREATE DATABASE "${legacyName}"`);created=true;
  const reviewed=JSON.parse(readFileSync(join(migrationsDir(),'../test/fixtures/migration-manifest-20261030.json'),'utf8')) as {migrations:{version:string;checksum:string}[]};
  const prefix=reviewed.migrations.filter(x=>Number(x.version.slice(0,3))<=14);assert.equal(prefix.length,14);
  for(const entry of prefix)copyFileSync(join(migrationsDir(),entry.version),join(dir,entry.version));mkdirSync(join(dir,'repeatable'));copyFileSync(join(migrationsDir(),'repeatable/privileges.sql'),join(dir,'repeatable/privileges.sql'));
  const applied=await migrate(legacy,dir);assert.deepEqual(applied.applied,prefix.map(x=>x.version));assert.deepEqual((await legacy.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,prefix);
  const id=randomUUID(),email=uniqueEmail(),now=new Date(),attempt=randomUUID(),questionId='pre015-synthetic-mock',version='synthetic-v1',options=['a','b','c','d','e'];
  await new UsersRepository().insert(legacy,{id,emailNormalized:email.toLowerCase(),emailDisplay:email,passwordHash:await new PasswordService().hash(PASSWORD),displayName:'legacy fixture',now});
  await legacy.query("INSERT INTO hanq.question_versions(question_id,version,kind,is_current,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,$2,'mock',true,79,1,1,$3,'a','{}','{}',$4,$5)",[questionId,version,options,'0'.repeat(64),now]);
  await new AttemptsRepository().insert(legacy,{id:attempt,userId:id,submissionId:randomUUID(),questionId,version,optionId:'b',correct:false,source:'practice',payloadHash:Buffer.alloc(32),now});
  await legacy.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at)VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now())",[id,attempt]);
  const before=JSON.stringify((await legacy.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows);url.pathname='/'+legacyName;
  r=run({HANQ_TEST_DATABASE_URL:url.href});assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).negativeBalances,'1');assert.equal(JSON.parse(r.stdout).status,'reconciliation-required');assert.equal(JSON.parse(r.stdout).readOnly,true);assert.equal(JSON.stringify((await legacy.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows),before,'read-only command never rewrites the legacy fixture');assert.ok(!r.stdout.includes(id)&&!r.stdout.includes(email)&&!r.stdout.includes(PASSWORD)&&!r.stdout.includes('postgres://')&&!r.stdout.includes(url.password));
 }finally{
  await legacy.end();if(created)await pool.query(`DROP DATABASE "${legacyName}"`);rmSync(dir,{recursive:true,force:true});
 }
 assert.equal(JSON.stringify((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows),fullBefore);assert.equal(await guards(),guardsBefore,'full-schema guards were never disabled');
 r=run({HANQ_TEST_DATABASE_URL:'invalid'});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).status,'unavailable');
});
