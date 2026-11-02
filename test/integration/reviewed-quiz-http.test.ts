import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, buyPremium, signup, startApp, subId, type TestApp } from '../helpers/app';
import { freshDatabase, frontCatalog } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('whole source-reviewed curriculum saves and grades against the exact front scope',()=>{
 let t:TestApp,pool:Pool;const pack=frontCatalog().filter(q=>q.questionId.startsWith('z-reviewed-'));
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});after(async()=>{await t.close();await pool.end();});
 it('every selected question saves correct/wrong choices, all5 explanations and existing SID replay once',async()=>{
  const s=await signup(t);await buyPremium(t,s);let first:{questionId:string;version:string;optionId:string;submissionId:string}|null=null,firstId:string|null=null;
  for(const q of pack){const pair={questionId:q.questionId,version:q.version};const wrong=q.optionIds.find(id=>id!==q.correctOptionId)!;
   for(const optionId of [wrong,q.correctOptionId]){const body={...pair,optionId,submissionId:subId()},res=await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(body);assert.equal(res.status,201,q.questionId);assert.equal(res.body.attempt.correct,optionId===q.correctOptionId);assert.equal(res.body.review.item.options.length,5);assert.ok(res.body.review.item.options.every((o:{verifiedBrief:string})=>!!o.verifiedBrief));assert.ok(res.body.review.item.verifiedCore.length>=3&&res.body.review.item.verifiedCore.length<=5);if(!first){first=body;firstId=res.body.attempt.id;}}
  }
  const replay=await request(t.server).post('/api/v1/attempts').set(bearer(s.access)).send(first!);assert.equal(replay.status,201);assert.equal(replay.body.attempt.id,firstId);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[s.userId])).rows[0].n,pack.length*2);
  const eras=new Set(pack.map(q=>q.questionId.split('-')[2]));for(const era of eras){const qs=pack.filter(q=>q.questionId.startsWith('z-reviewed-'+era+'-')).map(q=>({questionId:q.questionId,version:q.version}));assert.ok(era==='islands'?qs.length>=19&&qs.length<=21:qs.length>=50&&qs.length<=60,'reviewed source era scope');const res=await request(t.server).post('/api/v1/quiz/progress').set(bearer(s.access)).send({questions:qs});assert.equal(res.status,200);assert.equal(res.body.answered,qs.length);assert.ok(res.body.items.every((p:{correct:boolean})=>p.correct===true));}
 });
});
