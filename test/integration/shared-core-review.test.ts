import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import request from 'supertest';
import type {Pool} from 'pg';
import {bearer,buyPremium,signup,startApp,type TestApp} from '../helpers/app';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';

describe('shared core study content for every signed-in member',()=>{
 let app:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());app=await startApp();});
 after(async()=>{await app.close();await pool.end();});
 it('all eras: anonymous denied, free/premium/other identical; no personal fields or history writes',async()=>{
  const free=await signup(app),premium=await signup(app),other=await signup(app);await buyPremium(app,premium);
  const counts=async()=> (await pool.query(`SELECT (SELECT count(*) FROM hanq.attempts) attempts,(SELECT count(*) FROM hanq.manual_wrong_notes) notes,(SELECT count(*) FROM hanq.growth_ledger) growth,(SELECT count(*) FROM hanq.runs) runs,(SELECT count(*) FROM hanq.personal_review_profiles) profiles`)).rows[0];
  const before=await counts();
  for(const era of ['ancient','goryeo','joseon','opening','colonial','modern']){
   const url='/api/v1/reviews/core?era='+era;assert.equal((await request(app.server).get(url)).status,401);
   const results=[];for(const member of [free,premium,other]){const res=await request(app.server).get(url).set(bearer(member.access));assert.equal(res.status,200);results.push(res.body);}
   assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
   const body=JSON.stringify(results[0]);for(const forbidden of ['userId','email','questionId','sourceKey','submitted_answer','wrong_reason','observedMark','attempts','growth'])assert.equal(body.includes('"'+forbidden+'"'),false);
   if(era==='ancient'||era==='goryeo'){assert.equal(results[0].topics.length,era==='ancient'?21:22);assert.equal(body.includes('media/exam'),false,'no full question screenshot');}
  }
  assert.deepEqual(await counts(),before);
  assert.equal((await request(app.server).get('/api/v1/reviews/core?era=bad').set(bearer(free.access))).status,400);
  assert.equal((await request(app.server).get('/api/v1/wrong-notes/focused-review').set(bearer(free.access))).status,403,'personal premium endpoint remains protected');
  assert.equal((await request(app.server).get('/api/v1/wrong-notes').set(bearer(other.access))).status,403,'existing personal-note premium policy unchanged');
  assert.deepEqual((await request(app.server).get('/api/v1/wrong-notes').set(bearer(premium.access))).body.items,[]);
 });
});
