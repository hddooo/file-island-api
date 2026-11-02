import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after,before,it } from 'node:test';
import type { Pool } from 'pg';
import { projectRoot } from '../../src/common/project-root';
import { UsersRepository } from '../../src/auth/users.repository';
import { PasswordService } from '../../src/auth/password.service';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { PASSWORD,uniqueEmail } from '../helpers/app';
import { freshDatabase,sampleQuestions } from '../helpers/db';
import { testConfig,testEnv } from '../helpers/env';
let pool:Pool;
before(async()=>{pool=await freshDatabase(testConfig());});after(async()=>{await pool.end();});
it('read-only command reports pass, legacy negative aggregate and unavailable without IDs or credentials',async()=>{
 const run=(overrides:Record<string,string>={})=>spawnSync(process.execPath,[join(projectRoot(),'dist/scripts/check-growth-floor.js')],{env:{...process.env,...testEnv(overrides)},encoding:'utf8'});
 let r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).negativeBalances,'0');
 // Owned *_test fixture only: simulate a ledger made by a pre015 server. No operating connection or migration action.
 await pool.query('DROP TRIGGER growth_floor ON hanq.growth_ledger');
 const id=randomUUID(),email=uniqueEmail(),now=new Date();await new UsersRepository().insert(pool,{id,emailNormalized:email.toLowerCase(),emailDisplay:email,passwordHash:await new PasswordService().hash(PASSWORD),displayName:'legacy fixture',now});const q=sampleQuestions().mock[0],attempt=randomUUID();await new AttemptsRepository().insert(pool,{id:attempt,userId:id,submissionId:randomUUID(),questionId:q.questionId,version:q.version,optionId:q.optionIds.find(o=>o!==q.correctOptionId)!,correct:false,source:'practice',payloadHash:Buffer.alloc(32),now});await pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at)VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now())",[id,attempt]);
 const before=JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows);r=run();assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).negativeBalances,'1');assert.equal(JSON.parse(r.stdout).status,'reconciliation-required');assert.equal(JSON.stringify((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows),before,'read-only check cannot reconcile or rewrite history');assert.ok(!r.stdout.includes(id)&&!r.stdout.includes(email)&&!r.stdout.includes(PASSWORD)&&!r.stdout.includes('postgres://'));
 r=run({HANQ_TEST_DATABASE_URL:'invalid'});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).status,'unavailable');
});
