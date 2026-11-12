import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before,after,it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { UsersRepository } from '../../src/auth/users.repository';
import { PasswordService } from '../../src/auth/password.service';
import { bearer,buyPremium,signin,startApp,uniqueEmail,PASSWORD,type TestApp } from '../helpers/app';
import { freshDatabase,sampleQuestions,migrationsDir } from '../helpers/db';
import { testConfig } from '../helpers/env';
let pool:Pool,t:TestApp;
const dir=mkdtempSync(join(tmpdir(),'hanq-floor-test-'));
before(async()=>{pool=await freshDatabase(testConfig());for(let n=1;n<=50;n++)writeFileSync(join(dir,`79-${String(n).padStart(2,'0')}.webp`),Buffer.from('RIFF0000WEBPtest'));t=await startApp({HANQ_CBT_ASSET_DIR:dir});});
after(async()=>{await t.close();await pool.end();rmSync(dir,{recursive:true,force:true});});
it('legacy zero-balance user: concurrent deductions, immutable replay, CBT result and ledger agree at floor0',async()=>{
 // Pre-003 users legitimately have no signup ledger. Fixture creates that state without mutating any historical ledger.
 const email=uniqueEmail('legacy'),id=randomUUID();await new UsersRepository().insert(pool,{id,emailNormalized:email.toLowerCase(),emailDisplay:email,passwordHash:await new PasswordService().hash(PASSWORD),displayName:'legacy test',now:new Date('2026-10-01')});
 if(process.env.HANQ_QUAL_QUALIFICATION_PROFILE==='schema61-local-private-retained-base'){
  const fixture=createRequire(__filename)('/run/current-runtime-fixture.cjs') as {verifyDatabase(pool:Pool,config:ReturnType<typeof testConfig>):Promise<unknown>};
  await fixture.verifyDatabase(pool,testConfig());
  const row=await pool.query('SELECT id,email_normalized,approval_status FROM hanq.users WHERE id=$1 AND email_normalized=$2',[id,email.toLowerCase()]);
  assert.deepEqual(row.rows,[{id,email_normalized:email.toLowerCase(),approval_status:'pending'}]);
  for(const table of ['member_roles','growth_ledger','session_families'])assert.equal((await pool.query('SELECT 1 FROM hanq.'+table+' WHERE user_id=$1',[id])).rowCount,0);
  // Existing pre058 members were migrated to approved; this newly allocated synthetic legacy row reproduces that state only.
  assert.equal((await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1 AND email_normalized=$2 AND approval_status='pending'",[id,email.toLowerCase()])).rowCount,1);
  for(const table of ['member_roles','growth_ledger'])assert.equal((await pool.query('SELECT 1 FROM hanq.'+table+' WHERE user_id=$1',[id])).rowCount,0);
 }
 // This legacy fixture already attended before daily XP existed, so its empty ledger remains empty.
 await pool.query('INSERT INTO hanq.attendance(user_id,day,created_at) VALUES($1,$2,$3)',[id,new Date(t.clock.now().getTime()+9*3600000).toISOString().slice(0,10),t.clock.now()]);
 const s=await signin(t,email);await buyPremium(t,s);
 const {quiz,mock,wrongOf}=sampleQuestions();
 const floorMock=mock.find(q=>q.points===3);assert.ok(floorMock,'fixture must include an original3point mock item so two deductions cross zero');
 const post=(q:typeof quiz[number],correct:boolean,key=randomUUID())=>request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send({questionId:q.questionId,version:q.version,optionId:correct?q.correctOptionId:wrongOf(q),submissionId:key});
 const balance=async()=>Number((await pool.query('SELECT coalesce(sum(amount),0)::text n FROM hanq.growth_ledger WHERE user_id=$1',[id])).rows[0].n);
 const fund=async()=>{for(let n=0;n<3;n++){const r=await post(quiz[n],true);assert.equal(r.status,201);assert.equal(r.body.growth.delta,1);}};
 await fund();assert.equal(await balance(),3);
 const keys=[randomUUID(),randomUUID()];const both=await Promise.all(keys.map(k=>post(floorMock,false,k)));assert.ok(both.every(r=>r.status===201));assert.deepEqual(both.map(r=>r.body.growth.delta).sort((a,b)=>a-b),[-floorMock.points,0]);assert.equal(await balance(),0);
 for(let n=0;n<2;n++){const r=await post(floorMock,false,keys[n]);assert.equal(r.body.replayed,true);const stored=await pool.query('SELECT amount FROM hanq.growth_ledger WHERE user_id=$1 AND attempt_id=$2',[id,r.body.attempt.id]);assert.equal(stored.rowCount,1);assert.equal(r.body.growth.delta,stored.rows[0].amount);assert.equal(r.body.growth.points,0);}
 const counts=await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1',[id]);assert.equal(counts.rows[0].n,5);
 await fund();const created=await request(t.server).post('/api/v1/cbt/runs').set(bearer(s.access)).send({round:79,idempotencyKey:randomUUID(),answerMode:'batch'});assert.equal(created.status,201);const run=created.body.run.id;
 assert.equal((await request(t.server).post(`/api/v1/cbt/runs/${run}/start`).set(bearer(s.access)).send({})).status,200);
 const body={submissionKey:randomUUID(),currentPosition:49,answers:Array.from({length:50},(_,position)=>({position,optionId:null}))};const submit=()=>request(t.server).post(`/api/v1/cbt/runs/${run}/submit`).set(bearer(s.access)).send(body);
 // All50 fixture answers are null: score0 falls below60 in the current
 // first-round bands, requesting -10; the independent opening3XP bounds it at -3.
 const final=await submit();assert.equal(final.status,200);assert.equal(final.body.run.result.score,0);assert.equal(final.body.run.result.answered,0);assert.equal(final.body.run.result.growthPolicy,'round-first-score-bands-v1');assert.equal(final.body.run.result.rewardEligible,true);assert.equal(final.body.run.result.policyGrowthReward,-10);assert.equal(final.body.run.result.growthReward,-3);assert.equal(await balance(),0);assert.deepEqual((await submit()).body.run.result,final.body.run.result);
 assert.deepEqual((await pool.query('SELECT amount FROM hanq.growth_ledger WHERE cbt_run_id=$1',[run])).rows,[{amount:-3}]);assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE cbt_run_id=$1',[run])).rows[0].n,50);
 // DB floor also protects insert paths outside the app owner lock. Distinct valid attempt FK/event keys retain one-event identity.
 await fund();assert.equal(await balance(),3);
 const legacy=(await pool.query('SELECT id FROM hanq.attempts WHERE user_id=$1 AND cbt_run_id=$2 ORDER BY id LIMIT 2',[id,run])).rows;
 const inserts=await Promise.all(legacy.map(a=>pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at) VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now()) RETURNING amount",[id,a.id])));assert.deepEqual(inserts.map(r=>r.rows[0].amount).sort((a,b)=>a-b),[-3,0]);assert.equal(await balance(),0);
 for(let n=0;n<20;n++){const r=await post(quiz[n],false);assert.equal(r.status,201);assert.equal(r.body.growth.delta,0);}
 const study=await request(t.server).post('/api/v1/wrong-notes/study').set(bearer(s.access)).send({});assert.equal(study.status,201);assert.equal(study.body.items.length,20);t.clock.advance(3000);
 const settleStudy=()=>request(t.server).post(`/api/v1/runs/${study.body.run.id}/submit`).set(bearer(s.access));const studyFinal=await settleStudy();assert.equal(studyFinal.status,200);assert.equal(studyFinal.body.run.score.growthReward,0);assert.equal((await settleStudy()).body.run.score.growthReward,0);assert.equal(await balance(),0);
 // A pre-015 negative ledger cannot be seeded through today's collection projection:
 // first prove the current XP constraint rejects it, then model the historical
 // ledger-only state inside this transaction. ROLLBACK restores both guards/data.
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('DROP TRIGGER growth_floor ON hanq.growth_ledger');
  const unused=(await client.query('SELECT id FROM hanq.attempts WHERE cbt_run_id=$1 ORDER BY id OFFSET 2 LIMIT 1',[run])).rows[0].id;
  const negative=()=>client.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attempt_id,created_at) VALUES($1,'practice:'||$2::uuid::text,'practice-mock',-5,$2,now())",[id,unused]);
  await client.query('SAVEPOINT current_projection_guard');
  await assert.rejects(negative(),(error:unknown)=>{
   const e=error as {code?:string;constraint?:string};
   return e.code==='23514'&&e.constraint==='owned_digimon_xp_check';
  });
  await client.query('ROLLBACK TO SAVEPOINT current_projection_guard');
  await client.query('ALTER TABLE hanq.growth_ledger DISABLE TRIGGER growth_apply_digimon');
  await negative();
  assert.equal(Number((await client.query('SELECT sum(amount)::text n FROM hanq.growth_ledger WHERE user_id=$1',[id])).rows[0].n),-5,'deliberately reconstructed historical negative ledger');
  await assert.rejects(client.query(readFileSync(join(migrationsDir(),'015_growth_floor.sql'),'utf8')),/Negative growth balances require approved reconciliation/);
 }finally{await client.query('ROLLBACK');client.release();}
 assert.equal(await balance(),0);
 assert.deepEqual((await pool.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='hanq.growth_ledger'::regclass AND tgname IN('growth_floor','growth_apply_digimon') ORDER BY tgname")).rows,[{tgname:'growth_apply_digimon',tgenabled:'O'},{tgname:'growth_floor',tgenabled:'O'}],'both guards restored after fixture rollback');
 assert.equal(Number((await pool.query('SELECT sum(xp)::text xp FROM hanq.owned_digimon WHERE user_id=$1',[id])).rows[0].xp),0,'equipped XP still equals the unchanged zero ledger');
 await assert.rejects(pool.query('UPDATE hanq.growth_ledger SET amount=1 WHERE user_id=$1',[id]),/append-only/);
});
