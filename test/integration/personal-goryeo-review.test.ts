import assert from 'node:assert/strict';
import { before,after,describe,it } from 'node:test';
import request from 'supertest';
import type { Pool } from 'pg';
import { bearer,buyPremium,signup,startApp,type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('Goryeo private content enrollment independent of wrong notes',()=>{
 let app:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());app=await startApp();});
 after(async()=>{await app.close();await pool.end();});
 it('guards access; only enrolled owner sees 22 notes; no fabricated history or wrong-note membership',async()=>{
  const owner=await signup(app),other=await signup(app),free=await signup(app);await buyPremium(app,owner);await buyPremium(app,other);
  const url='/api/v1/wrong-notes/focused-review?era=goryeo';
  assert.equal((await request(app.server).get(url)).status,401);
  assert.equal((await request(app.server).get(url).set(bearer(free.access))).status,403);
  const counts=async()=> (await pool.query(`SELECT (SELECT count(*) FROM hanq.attempts WHERE user_id=$1) attempts,(SELECT count(*) FROM hanq.manual_wrong_notes WHERE user_id=$1) notes,(SELECT count(*) FROM hanq.growth_ledger WHERE user_id=$1) growth,(SELECT count(*) FROM hanq.runs WHERE user_id=$1) runs`,[owner.userId])).rows[0];
  const before=await counts();assert.deepEqual((await request(app.server).get(url).set(bearer(owner.access))).body.notes,[]);
  await pool.query('INSERT INTO hanq.personal_review_profiles(user_id,era,content_key) VALUES($1,$2,$3)',[owner.userId,'goryeo','goryeo-book-22-v1']);
  const result=await request(app.server).get(url).set(bearer(owner.access));assert.equal(result.status,200);assert.equal(result.body.era,'goryeo');assert.equal(result.body.notes.length,22);assert.equal(new Set(result.body.notes.map((n:{questionId:string})=>n.questionId)).size,22);
  assert.deepEqual(await counts(),before);assert.deepEqual((await request(app.server).get(url).set(bearer(other.access))).body.notes,[]);
  assert.deepEqual((await request(app.server).get('/api/v1/wrong-notes/focused-review').set(bearer(owner.access))).body.notes,[]);
  assert.equal((await request(app.server).get('/api/v1/wrong-notes/focused-review?era=bad').set(bearer(owner.access))).status,400);
  assert.equal(JSON.stringify((await request(app.server).get('/api/v1/questions?limit=5')).body).includes('goryeo-book-22-v1'),false);
  await pool.query('DELETE FROM hanq.personal_review_profiles WHERE user_id=$1',[owner.userId]);assert.deepEqual((await request(app.server).get(url).set(bearer(owner.access))).body.notes,[]);
 });
});
