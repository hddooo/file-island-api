import assert from 'node:assert/strict';
import {after,before,it} from 'node:test';
import request from 'supertest';
import type {Pool} from 'pg';
import {bearer,buyPremium,signin,signup,startApp,type Session,type TestApp} from '../helpers/app';
import {freshDatabase,sampleQuestions} from '../helpers/db';
import {testConfig} from '../helpers/env';
let pool:Pool,t:TestApp,a:Session,b:Session;
before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();a=await signup(t);b=await signup(t);});
after(async()=>{await t.close();await pool.end();});
it('ranking profiles expose only three public summaries, sign-in and owned partner XP, with authenticated access',async()=>{
 const api=()=>request(t.server);const list=await api().get('/api/v1/hall-of-fame').set(bearer(b.access)).expect(200);
 const mine=list.body.items.find((x:{isMe:boolean})=>x.isMe);assert.match(mine.profileRef,/^[a-f0-9]{32}$/);assert(!JSON.stringify(mine).includes(b.userId));
 const path='/api/v1/hall-of-fame/profiles/'+mine.profileRef;await api().get(path).expect(401);await api().get('/api/v1/hall-of-fame/profiles/'+('f'.repeat(32))).set(bearer(a.access)).expect(404);
 const empty=await api().get(path).set(bearer(a.access)).expect(200);assert.equal(empty.body.lastSigninAt,null);assert.equal(empty.body.recent.length,0);assert.equal(empty.body.totalXp,empty.body.monsters.reduce((n:number,p:{xp:number})=>n+p.xp,0));
 await signin(t,b.email);await buyPremium(t,b);const {quiz}=sampleQuestions();for(let i=0;i<4;i++)await api().post('/api/v1/attempts').set(bearer(b.access)).send({submissionId:'public-profile-'+i,questionId:quiz[i].questionId,version:quiz[i].version,optionId:quiz[i].correctOptionId}).expect(201);
 const r=await api().get(path).set(bearer(a.access)).expect(200);assert.equal(r.body.lastSigninAt,t.clock.now().toISOString());assert.equal(r.body.recent.length,3);assert(r.body.recent.every((x:object)=>Object.keys(x).sort().join(',')==='at,kind,subject'));assert.equal(r.body.totalXp,r.body.monsters.reduce((n:number,p:{xp:number})=>n+p.xp,0));const text=JSON.stringify(r.body);for(const forbidden of [b.email,b.userId,quiz[0].correctOptionId,'optionId','questionId','selected','password','token','email'])assert(!text.includes(forbidden));
});
