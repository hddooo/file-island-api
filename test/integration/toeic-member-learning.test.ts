import 'reflect-metadata';
import assert from 'node:assert/strict';
import {after,before,describe,it} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import request from 'supertest';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';
import {bearer,signup,startApp,type TestApp} from '../helpers/app';
import {toeicFixture} from '../helpers/toeic-fixture';
import {storePrivateToeicCollection} from '../../src/toeic-cbt/import';

describe('published TOEIC source with private member answers',()=>{
 let t:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('shares material and numbering, keeps checks/history private, denies foreign source and edits',async()=>{
  const a=await signup(t),b=await signup(t),c=await signup(t),source=toeicFixture();
  const id=await storePrivateToeicCollection(pool,a.userId,source),foreign=await storePrivateToeicCollection(pool,b.userId,source);
  const noteId=randomUUID(),note={part:'1',expression:'synthetic published term',meaning:'synthetic',structure:'',example:'Synthetic example.',confusion:'',sourceText:'Synthetic example.',sourceReference:'isolated fixture',revision:0};
  await request(t.server).put('/api/v1/toeic-notes/'+noteId).set(bearer(a.access)).send(note).expect(200);
  await pool.query('INSERT INTO hanq.toeic_member_notebook(owner_id) VALUES($1)',[a.userId]);
  try{
   const base='/api/v1/toeic-cbt',strip=(data:{items:Record<string,unknown>[]})=>data.items.map(({studyHistory:_studyHistory,...item})=>item);
   const listA=await request(t.server).get(base+'/practice').set(bearer(a.access)).expect(200),listB=await request(t.server).get(base+'/practice').set(bearer(b.access)).expect(200);
   assert.deepEqual(strip(listA.body),strip(listB.body));
   assert(listB.body.items.every((q:{collectionId:string})=>q.collectionId===id));
   assert.deepEqual((await request(t.server).get(base+'/player').set(bearer(a.access)).expect(200)).body,(await request(t.server).get(base+'/player').set(bearer(b.access)).expect(200)).body);
   const notesA=await request(t.server).get('/api/v1/toeic-notes').set(bearer(a.access)).expect(200),notesB=await request(t.server).get('/api/v1/toeic-notes').set(bearer(b.access)).expect(200);
   assert.deepEqual(notesA.body.notes,notesB.body.notes);assert.equal(notesB.body.canManage,false);
   await request(t.server).put('/api/v1/toeic-notes/'+noteId).set(bearer(b.access)).send(note).expect(403);
   await request(t.server).get(base+'/collections/'+foreign+'/practice').set(bearer(c.access)).expect(404);
   const answer={number:1,optionId:'A',requestKey:'shared-bank-private-answer-1'};
   await request(t.server).post(base+'/collections/'+id+'/answer').set(bearer(b.access)).send(answer).expect(201);
   await request(t.server).post(base+'/collections/'+id+'/answer').set(bearer(b.access)).send(answer).expect(201);
   const counts=(await pool.query('SELECT user_id,count(*)::int n FROM hanq.toeic_cbt_practice_answers GROUP BY user_id')).rows;
   assert.deepEqual(counts,[{user_id:b.userId,n:1}]);
   assert.equal((await request(t.server).get(base+'/practice-history').set(bearer(a.access)).expect(200)).body.total,0);
   assert.equal((await request(t.server).get(base+'/practice-history').set(bearer(b.access)).expect(200)).body.total,1);
   assert.equal((await request(t.server).get(base+'/practice-history').set(bearer(c.access)).expect(200)).body.total,0);
   await request(t.server).get(base+'/practice').expect(401);await request(t.server).get(base+'/player').expect(401);await request(t.server).get('/api/v1/toeic-notes').expect(401);
   assert.equal((await pool.query('SELECT id FROM hanq.toeic_cbt_collections WHERE user_id=$1',[b.userId])).rows[0].id,foreign);
  }finally{await pool.query('DELETE FROM hanq.toeic_member_notebook');}
 });
});
