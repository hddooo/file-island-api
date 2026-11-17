import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CbtFinishDto } from '../../src/cbt/cbt.dto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CbtService } from '../../src/cbt/cbt.service';
import { CbtRepository, type CbtRunRow } from '../../src/cbt/cbt.repository';
import { DbService } from '../../src/db/db.service';
import { AttemptsRepository } from '../../src/attempts/attempts.repository';
import { CbtAssetsService } from '../../src/cbt/cbt-assets.service';
import { sha256 } from '../../src/common/util';

const id='10000000-0000-4000-8000-000000000001';
const token='20000000-0000-4000-8000-000000000001';
const intent={submissionIntent:'explicit-q50-before-deadline-v1' as const};
function fixture(offset=-1, position=49, status:CbtRunRow['status']='active'){
 const end=new Date('2026-01-01T02:00:00Z'),now=new Date(end.getTime()+offset);
 const run={id,user_id:id,idempotency_key:'synthetic',exam_round:70,status,attempt_policy:'uninterrupted-v1',attempt_token_hash:sha256(token).toString('hex'),current_position:position,checkpoint_version:1,ends_at:end,created_at:now,started_at:now,answer_mode:'legacy',result:null} as CbtRunRow;
 const writes:string[]=[];
 const items=Array.from({length:50},(_,position)=>({position,question_id:`synthetic-${position}`,version:'v1',exam_number:position+1,points:2,option_ids:['a','b','c','d','e'],answer_option_id:'a',answered_at:new Date(end.getTime()-10),correct:null,attempt_id:null,era:'ancient',public_payload:{},correct_option_id:'a',review_payload:{}}));
 const q={query:async(sql:string)=>{
   if(sql.includes("status='incomplete'")){run.status='incomplete';run.incomplete_reason='time_expired';writes.push('incomplete');}
   if(sql.includes('INSERT INTO hanq.growth_ledger'))writes.push('growth');
   return {rows:sql.includes('SELECT xp::text points')?[{points:'0'}]:[]};
 }};
 const repo={findOwned:async()=>run,items:async()=>items,listOwned:async()=>[{...run,answered:50}],dueRunIds:async()=>[id],validEraIds:async()=>new Set(),finalItems:async()=>[],gradeItem:async()=>{writes.push('grade');},finalize:async(_q:unknown,_id:string,_at:Date,reason:string,result:Record<string,unknown>)=>{writes.push('final');run.status='final';run.final_reason=reason as 'submit';run.result=result;},findByKey:async()=>null,roundQuestions:async()=>[]};
 const attempts={insert:async(_q:unknown,input:{correct:boolean})=>{writes.push('attempt');return {id,correct:input.correct};}};
 const svc=new CbtService({now:()=>now},{tx:async(fn:(q:unknown)=>Promise<unknown>)=>fn(q),pool:q} as unknown as DbService,repo as unknown as CbtRepository,attempts as unknown as AttemptsRepository,{} as CbtAssetsService);
 return {svc,run,writes,repo,items};
}
for(const offset of [0,1])for(const route of ['get','list','start','claim','checkpoint','submit','abandon'] as const){
 test(`${route}: deadline ${offset}ms => incomplete, zero score/attempt/growth writes`,async()=>{
  const {svc,run,writes}=fixture(offset);
  if(route==='checkpoint')await assert.rejects(svc.checkpoint(id,id,{version:2,currentPosition:49,answers:[]},token),{code:'run_closed'});
  else if(route==='start'||route==='claim')await svc[route](id,id,token);
  else if(route==='submit')await svc.submit(id,id,intent,token);
  else if(route==='list')await svc.list(id);
  else await svc[route](id,id);
  assert.equal(run.status,'incomplete');assert.equal(run.result,null);assert.deepEqual(writes,['incomplete']);
 });
}
test('markerless and pre-Q50 submits preserve active progress',async()=>{
 for(const [position,body,code] of [[49,{},'explicit_submit_required'],[48,intent,'final_question_required']] as const){
 const {svc,run,writes}=fixture(-1,position);await assert.rejects(svc.submit(id,id,body,token),{code});assert.equal(run.status,'active');assert.deepEqual(writes,[]);
 }
});
test('zero checkpoint version rejected even at Q50',async()=>{const {svc,run,writes}=fixture();run.checkpoint_version=0;await assert.rejects(svc.submit(id,id,intent,token),{code:'final_question_required'});assert.deepEqual(writes,[]);});
test('explicit saved Q50 before deadline writes exactly 50 attempts and one result/reward; replay no extra writes',async()=>{
 const {svc,run,writes}=fixture();await svc.submit(id,id,intent,token);await svc.submit(id,id,intent,token);
 assert.equal(run.status,'final');assert.equal(run.final_reason,'submit');assert.equal(run.result?.score,100);
 assert.equal(writes.filter(x=>x==='attempt').length,50);assert.equal(writes.filter(x=>x==='growth').length,1);assert.equal(writes.filter(x=>x==='final').length,1);
});
test('existing immutable final returned unchanged without intent',async()=>{const {svc,run,writes}=fixture(1,49,'final');run.result={score:71};await svc.submit(id,id,{},token);assert.deepEqual(run.result,{score:71});assert.deepEqual(writes,[]);});
test('old active session not erased by missing marker, and upgraded client can submit it',async()=>{const {svc,run}=fixture();await assert.rejects(svc.submit(id,id,{},token),{code:'explicit_submit_required'});await svc.submit(id,id,intent,token);assert.equal(run.status,'final');});
test('wrong attempt token never finalizes or expires owned run',async()=>{const {svc,writes}=fixture(1);await assert.rejects(svc.submit(id,id,intent,'bad'),{code:'attempt_session_required'});assert.deepEqual(writes,[]);});

test('idempotent create replay expires without grading and advertises strict capability',async()=>{const {svc,run,writes,repo}=fixture(0);repo.findByKey=async()=>run as never;const value=await svc.create(id,{round:70,idempotencyKey:'synthetic'});assert.equal(value.run.status,'incomplete');assert.equal(value.run.submissionPolicy,'explicit-q50-before-deadline-v1');assert.deepEqual(writes,['incomplete']);});

test('stats settles expiry without adding final history',async()=>{const {svc,writes}=fixture(0);const stats=await svc.stats(id);assert.equal(stats.runs,0);assert.deepEqual(writes,['incomplete']);});
test('finish DTO permits exact explicit intent and rejects wrong intent/answer injection',async()=>{const opts={whitelist:true,forbidNonWhitelisted:true};assert.equal((await validate(plainToInstance(CbtFinishDto,intent),opts)).length,0);for(const body of [{submissionIntent:'automatic'}, {...intent,answers:[]}])assert((await validate(plainToInstance(CbtFinishDto,body),opts)).length>0);});

test('all-blank explicit Q50 is rejected, but genuine answered zero score is retained',async()=>{const blank=fixture();for(const item of blank.items)item.answer_option_id=null as unknown as string;await assert.rejects(blank.svc.submit(id,id,intent,token),{code:'answers_required'});assert.deepEqual(blank.writes,[]);const zero=fixture();for(const item of zero.items)item.correct_option_id='b';await zero.svc.submit(id,id,intent,token);assert.equal(zero.run.status,'final');assert.equal(zero.run.result?.score,0);});
