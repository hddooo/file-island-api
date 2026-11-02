import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {startApp,signup,signin,bearer,type TestApp,type Session} from '../helpers/app';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';

describe('word checks on isolated PostgreSQL and real auth sessions',()=>{
 let t:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 const get=(s:Session)=>request(t.server).get('/api/v1/toeic-word-checks').set(bearer(s.access));
 const put=(s:Session,ids:string[],revision:number,importLegacy=false)=>request(t.server).put('/api/v1/toeic-word-checks').set(bearer(s.access)).send({ids,revision,importLegacy});
 it('persists check/uncheck across sign-in, serializes devices, rejects legacy resurrection and isolates accounts',async()=>{
  const a=await signup(t),second=await signin(t,a.email),b=await signup(t);
  await request(t.server).get('/api/v1/toeic-word-checks').expect(401);
  assert.deepEqual((await get(a)).body,{ids:[],revision:0,legacyImported:false});
  await put(a,['supplement:until'],0,true).expect(200);
  assert.deepEqual((await get(second)).body.ids,['supplement:until']);
  assert.deepEqual((await get(b)).body.ids,[]);
  await put(a,[],1).expect(200);
  await put(second,['supplement:until'],1).expect(409);
  await put(second,['supplement:until'],2,true).expect(409);
  const relogin=await signin(t,a.email);assert.deepEqual((await get(relogin)).body.ids,[]);
  const concurrent=await Promise.all([put(a,['supplement:because'],2),put(second,['supplement:despite'],2)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const current=(await get(relogin)).body;assert.equal(current.ids.length,1);assert.equal(current.revision,3);
  await put(a,[],3).expect(200);assert.deepEqual((await get(second)).body.ids,[]);
  await put(b,['supplement:until'],0).expect(200);assert.deepEqual((await get(a)).body.ids,[]);
  await request(t.server).put('/api/v1/toeic-word-checks').set(bearer(a.access)).send({ids:[],revision:4,importLegacy:false,userId:b.userId}).expect(400);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM hanq.toeic_word_checks')).rows[0].n),2);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM hanq.toeic_notes')).rows[0].n),0);
 });
});
