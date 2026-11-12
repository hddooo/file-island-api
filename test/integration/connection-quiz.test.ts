const current61=process.env.HANQ_QUAL_QUALIFICATION_PROFILE==='schema61-local-private-retained-base';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import { randomUUID } from 'node:crypto';
import { after,before,it } from 'node:test';
import request from 'supertest';
import type { Pool } from 'pg';
import { bearer,buyPremium,signup,startApp,type TestApp } from '../helpers/app';
import { freshDatabase,frontCatalog } from '../helpers/db';
import { testConfig,TestClock } from '../helpers/env';
let pool:Pool,t:TestApp;
before(async()=>{pool=await freshDatabase(testConfig());t=await startApp({},new TestClock());});
after(async()=>{await t.close();await pool.end();});
it('all239 connection-source questions keep existing access, grading, owner progress and one record per submission',async()=>{
 const ids=new Set<string>(JSON.parse(readFileSync(join(process.env.HANQ_FRONT_DIR!,'scripts/fixtures/connection-quiz-map.json'),'utf8')).mapping.map((x:{id:string})=>x.id));const items=frontCatalog().filter(q=>ids.has(q.questionId));assert.equal(items.length,239);
 const a=await signup(t),b=await signup(t);
 const post=(q:typeof items[number],key:string)=>request(t.server).post('/api/v1/attempts').set(bearer(a.access)).send({questionId:q.questionId,version:q.version,optionId:q.correctOptionId,submissionId:key});
 assert.equal((await post(items[0],randomUUID())).status,403);assert.equal((await buyPremium(t,a)).status,200);
 for(const q of items){const key=randomUUID();const r=await post(q,key);assert.equal(r.status,201);assert.equal(r.body.attempt.correct,true);assert.equal((await post(q,key)).status,201);}
 const scope=items.map(q=>({questionId:q.questionId,version:q.version}));const read=await request(t.server).post('/api/v1/quiz/progress').set(bearer(a.access)).send({questions:scope});assert.equal(read.status,200);assert.equal(read.body.answered,239);
 const other=await request(t.server).post('/api/v1/quiz/progress').set(bearer(b.access)).send({questions:scope});assert.equal(other.status,200);assert.equal(other.body.answered,0);
 const count=await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1 AND question_id=ANY($2::text[])',[a.userId,[...ids]]);assert.equal(count.rows[0].n,239);
 if(current61){assert.equal((await request(t.server).get('/api/v1/questions/'+items[0].questionId)).status,401);assert.equal((await request(t.server).get('/api/v1/questions/'+items[0].questionId).set(bearer('synthetic-invalid-token'))).status,401);}
 const pub=await request(t.server).get('/api/v1/questions/'+items[0].questionId).set(current61?bearer(a.access):{});assert.equal(pub.status,200);assert.equal(pub.body.item.options.length,5);assert.ok(!JSON.stringify(pub.body).includes('"correct"'));
});
it('source-reviewed peer choices are wrong, true answers are correct and identical retries add no attempts',async()=>{
 const profile=JSON.parse(readFileSync(join(process.env.HANQ_FRONT_DIR!,'scripts/fixtures/connection-choice-overrides.json'),'utf8')).profiles as Record<string,unknown>;
 const items=frontCatalog().filter(q=>Object.hasOwn(profile,q.questionId));assert.equal(items.length,10);
 const a=await signup(t);assert.equal((await buyPremium(t,a)).status,200);let submissions=0;
 for(const q of items){for(const optionId of q.optionIds){const submissionId=randomUUID(),body={questionId:q.questionId,version:q.version,optionId,submissionId};
  const r=await request(t.server).post('/api/v1/attempts').set(bearer(a.access)).send(body);assert.equal(r.status,201);assert.equal(r.body.attempt.correct,optionId===q.correctOptionId);
  const again=await request(t.server).post('/api/v1/attempts').set(bearer(a.access)).send(body);assert.equal(again.status,201);assert.equal(again.body.attempt.id,r.body.attempt.id);submissions++;
 }}
 const count=await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[a.userId]);assert.equal(count.rows[0].n,submissions);
});
