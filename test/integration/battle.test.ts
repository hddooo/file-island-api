import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {before,after,it,describe} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';
import {signup,bearer,startApp,type TestApp} from '../helpers/app';
describe('opt-in battle API with separate learning records',()=>{
 let t:TestApp,pool:Pool;before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('guards presence, hides answers, accepts only opponent and preserves old growth and settles a battle once',async()=>{
  const a=await signup(t),b=await signup(t),c=await signup(t);const before=(await pool.query("SELECT user_id,event_key,amount FROM hanq.growth_ledger WHERE kind<>'battle' ORDER BY user_id,event_key")).rows;
  assert.equal((await request(t.server).get('/api/v1/battle/lobby')).status,401);
  await request(t.server).post('/api/v1/battle/enter').set(bearer(a.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201);
  const entered=await request(t.server).post('/api/v1/battle/enter').set(bearer(b.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201);
  assert.equal(entered.body.participants.length,2);assert(!JSON.stringify(entered.body).includes(a.userId));assert(!JSON.stringify(entered.body).includes(c.userId));
  const invitation=await request(t.server).post('/api/v1/battle/challenges').set(bearer(a.access)).send({opponent:entered.body.myId,subject:'history'}).expect(201);const id=invitation.body.id;
  await request(t.server).get('/api/v1/battle/matches/'+id).set(bearer(c.access)).expect(404);
  await request(t.server).post('/api/v1/battle/matches/'+id+'/accept').set(bearer(a.access)).send({}).expect(403);
  await request(t.server).post('/api/v1/battle/matches/'+id+'/accept').set(bearer(b.access)).send({}).expect(201);
  await request(t.server).post('/api/v1/battle/matches/'+id+'/ready').set(bearer(a.access)).send({round:1,clientTime:0}).expect(400);
  await request(t.server).post('/api/v1/battle/matches/'+id+'/ready').set(bearer(a.access)).send({round:1}).expect(201);
  const start=await request(t.server).post('/api/v1/battle/matches/'+id+'/ready').set(bearer(b.access)).send({round:1}).expect(201);assert.equal(start.body.deadline-start.body.start,30000);assert.equal(start.body.start-start.body.initialReadyUntil,3000);assert.equal(start.body.initialReadyUntil-start.body.serverNow,1000);assert(!JSON.stringify(start.body.question).includes('"answer"'));
  const ended=await request(t.server).post('/api/v1/battle/matches/'+id+'/forfeit').set(bearer(a.access)).send({}).expect(201);assert.equal(ended.body.winner,'right');assert.equal(ended.body.status,'finished');assert.deepEqual((await pool.query("SELECT user_id,event_key,amount FROM hanq.growth_ledger WHERE kind<>'battle' ORDER BY user_id,event_key")).rows,before);
 });
 it('keeps practice private and XP-free without creating a bot account',async()=>{
  const a=await signup(t),b=await signup(t);
  const snapshot=async()=>({users:(await pool.query('SELECT count(*)::int n FROM hanq.users')).rows[0].n,growth:(await pool.query('SELECT user_id,event_key,amount FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows,ledger:(await pool.query('SELECT count(*)::int n FROM hanq.battle_xp_ledger')).rows[0].n});
  const before=await snapshot();
  await request(t.server).post('/api/v1/battle/practice').send({family:'agumon',sessionId:randomUUID()}).expect(401);
  await request(t.server).post('/api/v1/battle/enter').set(bearer(a.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201);
  const created=await request(t.server).post('/api/v1/battle/practice').set(bearer(a.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201),id=created.body.id;
  assert.equal(created.body.practice,true);assert.equal(created.body.subject,'toeic');assert.equal(created.body.fighters.right.name,'연습 봇');assert.deepEqual(created.body.ready,{left:false,right:true});assert(!JSON.stringify(created.body.question).includes('"answer"'));
  const repeated=await request(t.server).post('/api/v1/battle/practice').set(bearer(a.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201);assert.equal(repeated.body.id,id);
  await request(t.server).get('/api/v1/battle/matches/'+id).set(bearer(b.access)).expect(404);
  await request(t.server).get('/api/v1/battle/history/'+id).set(bearer(a.access)).expect(404);
  for(let i=0;i<2;i++){const ended=await request(t.server).post('/api/v1/battle/matches/'+id+'/forfeit').set(bearer(a.access)).send({}).expect(201);assert.equal(ended.body.winner,'right');assert.equal(ended.body.reward.delta,0);}
  const review=await request(t.server).get('/api/v1/battle/history/'+id).set(bearer(a.access)).expect(200);assert.equal(review.body.practice,true);assert.equal(review.body.reward.delta,0);
  await request(t.server).get('/api/v1/battle/history/'+id).set(bearer(b.access)).expect(404);
  assert.deepEqual(await snapshot(),before);
 });

});
