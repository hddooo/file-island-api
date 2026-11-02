import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,it} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {bearer,signup,signin,startApp,subId,type Session,type TestApp} from '../helpers/app';
import {freshDatabase,frontCatalog} from '../helpers/db';
import {testConfig} from '../helpers/env';

interface Partner {id:string;family:string;points:number;stage:number;revision:number;equipped:boolean;hatchStartedAt:string|null;hatchReadyAt:string|null;hatchedAt:string|null}
interface Collection {items:Partner[];products:{family:string;priceCoin:number;owned:boolean}[];totalPoints:number;coinBalance:number;equippedId:string;revision:number;purchaseEnabled:boolean;hatchEnabled:boolean}
let pool:Pool,t:TestApp;
before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
after(async()=>{if(t)await t.close();if(pool)await pool.end();});
const state=async(s:Session):Promise<Collection>=>{const r=await request(t.server).get('/api/v1/me/partners').set(bearer(s.access));assert.equal(r.status,200);return r.body;};
const post=async(s:Session,action:string,body:object,status=200)=>{const r=await request(t.server).post('/api/v1/me/partners/'+action).set(bearer(s.access)).send(body);assert.equal(r.status,status);return r.body;};
const item=(p:Collection,id:string)=>{const x=p.items.find(x=>x.id===id);assert(x);return x;};
async function invariant(s:Session){const p=await state(s),r=await pool.query<{xp:string}>('SELECT coalesce(sum(amount),0)::text xp FROM hanq.growth_ledger WHERE user_id=$1',[s.userId]);assert.equal(p.totalPoints,Number(r.rows[0].xp));assert.equal(p.items.reduce((n,x)=>n+x.points,0),p.totalPoints);assert.equal(p.items.filter(x=>x.equipped).length,1);return p;}

it('coin eggs: real authenticated HTTP, concurrent unique ownership, server 59999/60000ms hatch, equipped-only XP and owner isolation',async()=>{
 const a=await signup(t),b=await signup(t);let p=await invariant(a);
 assert(p.purchaseEnabled&&p.hatchEnabled);assert.equal(p.coinBalance,0);assert.equal(p.totalPoints,1010,'signup1000 plus independently recorded first-day attendance10');
 assert(p.products.length>0&&p.products.every(x=>x.priceCoin===0));const first=p.equippedId;assert.equal(item(p,first).points,1010);
 for(const priceCoin of [1,-1,'0',null])await post(a,'claim',{family:'gabumon',priceCoin,requestId:randomUUID()},400);
 assert.equal((await state(a)).items.length,1);
 const key=randomUUID(),receipts=await Promise.all(Array.from({length:4},()=>post(a,'claim',{family:'gabumon',priceCoin:0,requestId:key})));
 const egg=receipts[0].partnerId as string;assert.equal(new Set(receipts.map(x=>x.partnerId)).size,1);assert.equal(receipts.filter(x=>!x.replayed).length,1);assert(receipts.every(x=>x.priceCoin===0&&x.currency==='Coin'));
 await post(a,'claim',{family:'patamon',priceCoin:0,requestId:key},409);await post(a,'claim',{family:'gabumon',priceCoin:0,requestId:randomUUID()},409);
 p=await invariant(a);assert.equal(item(p,egg).points,0);assert.equal(item(p,egg).hatchStartedAt,null);assert.equal(item(p,egg).stage,-1);
 await post(b,'equip',{id:egg,revision:p.revision,requestId:randomUUID()},404);assert(!(await state(b)).items.some(x=>x.id===egg));
 const equipKey=randomUUID(),equipRevision=p.revision,equipped=await post(a,'equip',{id:egg,revision:equipRevision,requestId:equipKey}),started=equipped.hatchStartedAt as string,ready=equipped.hatchReadyAt as string;
 assert.equal(Date.parse(ready)-Date.parse(started),60000);assert.equal(Date.parse(started),t.clock.now().getTime());
 await post(a,'equip',{id:first,revision:0,requestId:randomUUID(),serverNow:ready},400);
 const free=(await pool.query<{question_id:string}>("SELECT question_id FROM hanq.free_question_slots WHERE kind='quiz' ORDER BY chapter,position LIMIT 1")).rows[0],q=frontCatalog().find(x=>x.questionId===free.question_id);assert(q);
 const submissionId=subId(),answer=()=>request(t.server).post('/api/v1/attempts').set(bearer(a.access)).send({submissionId,questionId:q.questionId,version:q.version,optionId:q.correctOptionId});
 const answers=await Promise.all([answer(),answer()]);assert(answers.every(x=>x.status===201));assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1 AND submission_id=$2',[a.userId,submissionId])).rows[0].n,1);
 p=await invariant(a);assert.equal(item(p,egg).points,1);assert.equal(item(p,first).points,1010);assert.equal(p.totalPoints,1011);assert.equal(p.coinBalance,0);
 await post(a,'evolve',{id:egg,revision:item(p,egg).revision,requestId:randomUUID()},409);
 t.clock.advance(30000);p=await state(a);await post(a,'equip',{id:first,revision:p.revision,requestId:randomUUID()});
 t.clock.advance(29999);p=await invariant(a);assert.equal(item(p,egg).stage,-1);assert.equal(item(p,egg).points,1);assert.equal(item(p,egg).hatchReadyAt,ready);
 await post(a,'equip',{id:egg,revision:p.revision,requestId:randomUUID()});p=await state(a);assert.equal(item(p,egg).hatchStartedAt,started);assert.equal(item(p,egg).stage,-1);
 t.clock.advance(1);const reads=await Promise.all([state(a),state(a),request(t.server).get('/api/v1/me').set(bearer(a.access)).then(r=>{assert.equal(r.status,200);return r.body.partners as Collection;})]);
 assert(reads.every(x=>item(x,egg).stage===0));p=await invariant(a);assert.equal(item(p,egg).hatchedAt,ready);assert.equal(item(p,egg).points,1);
 const replay=await post(a,'equip',{id:egg,revision:equipRevision,requestId:equipKey});assert(replay.replayed);assert.equal(replay.stage,-1);assert.equal(item(await state(a),egg).stage,0);
 const second=await post(a,'claim',{family:'patamon',priceCoin:0,requestId:randomUUID()});p=await state(a);await post(a,'equip',{id:second.partnerId,revision:p.revision,requestId:randomUUID()});
 p=await state(a);const offlineReady=item(p,second.partnerId).hatchReadyAt;await post(a,'equip',{id:first,revision:p.revision,requestId:randomUUID()});t.clock.advance(600000);
 const signedIn=await signin(t,a.email);p=await invariant(signedIn);assert.equal(item(p,second.partnerId).stage,0);assert.equal(item(p,second.partnerId).hatchedAt,offlineReady);assert.equal(item(p,second.partnerId).points,0);assert.equal(item(p,egg).points,1);assert.equal(item(p,first).points,1010);assert.equal(p.totalPoints,1011);assert.equal(p.coinBalance,0);
 assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.digimon_commands WHERE user_id=$1 AND command='claim'",[a.userId])).rows[0].n,2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.owned_digimon WHERE user_id=$1 AND family=$2',[a.userId,'gabumon'])).rows[0].n,1);
});

