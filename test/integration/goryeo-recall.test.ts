const current61=process.env.HANQ_QUAL_QUALIFICATION_PROFILE==='schema61-local-private-retained-base';
import assert from 'node:assert/strict';
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
it('existing recall items use existing free/premium access, grading, owner progress and deduplicated records',async()=>{
 const items=frontCatalog().filter(q=>q.questionId.startsWith('z-goryeo-recall-'));assert.equal(items.length,17);
 const a=await signup(t),b=await signup(t);
 const post=(q:typeof items[number],key:string)=>request(t.server).post('/api/v1/attempts').set(bearer(a.access)).send({questionId:q.questionId,version:q.version,optionId:q.correctOptionId,submissionId:key});
 assert.equal((await post(items[0],randomUUID())).status,403);assert.equal((await buyPremium(t,a)).status,200);
 for(const q of items){const key=randomUUID();const r=await post(q,key);assert.equal(r.status,201);assert.equal(r.body.attempt.correct,true);assert.equal((await post(q,key)).status,201);}
 const scope=items.map(q=>({questionId:q.questionId,version:q.version}));const read=await request(t.server).post('/api/v1/quiz/progress').set(bearer(a.access)).send({questions:scope});assert.equal(read.status,200);assert.equal(read.body.answered,17);
 const other=await request(t.server).post('/api/v1/quiz/progress').set(bearer(b.access)).send({questions:scope});assert.equal(other.status,200);assert.equal(other.body.answered,0);
 const count=await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1 AND question_id LIKE $2',[a.userId,'z-goryeo-recall-%']);assert.equal(count.rows[0].n,17);
 if(current61){assert.equal((await request(t.server).get('/api/v1/questions/'+items[0].questionId)).status,401);assert.equal((await request(t.server).get('/api/v1/questions/'+items[0].questionId).set(bearer('synthetic-invalid-token'))).status,401);}
 const pub=await request(t.server).get('/api/v1/questions/'+items[0].questionId).set(current61?bearer(a.access):{});assert.equal(pub.status,200);assert.equal(pub.body.item.options.length,5);assert.ok(!JSON.stringify(pub.body).includes('"correct"'));
});
