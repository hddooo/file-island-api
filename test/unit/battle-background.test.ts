import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BattleService} from '../../src/battle/service';
import {fighter, type Bundle} from '../../src/battle/rules';
import type {DbService} from '../../src/db/db.service';

const now=100000;
// advance is a pure state transition: this fixture intentionally has no DB transport.
const svc=new BattleService({} as unknown as DbService,{now:()=>new Date(now)},()=>.99);
type BattleState=Parameters<BattleService['advance']>[0];
const advance=(s:BattleState,at=now)=>svc['advance'](s,at,false);
function bundle(audio=false):Bundle{return {key:'fixture',version:'v1',part:audio?3:5,prompt:'synthetic',passage:null,items:[],images:[],audio:audio?{url:'https://fixture.invalid/audio',seconds:1,sha256:'x'}:null,durationMs:60000};}
function state(audio=false):BattleState{return {status:'between',index:0,phaseAt:now-9000,result:{presentationMs:8000,events:[],cancelledItems:[],id:'result',round:1,attacker:null,reason:'neither_correct',miss:false,damage:0,leftCorrect:0,rightCorrect:0,answers:[],hp:{left:100,right:100},at:now-9000},last:{left:now,right:now},grace:null,connectionGap:false,bank:[{...bundle(),durationMs:30000},bundle(audio)],submissions:{left:{answers:[],at:now},right:{answers:[],at:now}},ready:{left:true,right:true},mediaServed:{left:true,right:true},start:1,deadline:2,created:now-9000,background:'ice',fighters:{left:fighter('A',1000,'agumon'),right:fighter('B',1000,'agumon')},winner:null,finishReason:null,revision:1,luk:[1,3,5,7,9,11],mediaErrors:0};}
test('server starts the next non-LC question after presentation without a client animation/ready ACK',()=>{const s=state();advance(s);assert.equal(s.index,1);assert.equal(s.status,'playing');assert.equal(s.start,now+3000);assert.equal(s.deadline,now+3000+60000);assert.deepEqual(s.ready,{left:true,right:true});});
test('LC still waits for actual prepared media and server-validated ready receipts',()=>{const s=state(true);advance(s);assert.equal(s.status,'ready');assert.equal(s.start,null);assert.deepEqual(s.ready,{left:false,right:false});});
test('initial entry still requires both explicit ready states',()=>{const s:BattleState={...state(),status:'ready',index:0,phaseAt:now,ready:{left:true,right:false},start:null,deadline:null};advance(s);assert.equal(s.status,'ready');assert.equal(s.start,null);});
test('a truly missing connection still receives the fixed next-question grace rather than fabricated presence',()=>{const s=state();s.last.left=now-6000;advance(s);assert.equal(s.status,'between');assert(s.grace);assert.equal(s.grace.end,now+10000);advance(s,now+2000);assert.equal(s.grace.end,now+10000);});
test('initial preparation never turns missing connections into a scored escape',()=>{const s:BattleState={...state(),status:'ready',index:0,phaseAt:now-20000,last:{left:0,right:0},ready:{left:false,right:false},start:null,deadline:null};advance(s);assert.equal(s.status,'ready');assert.equal(s.grace,null);advance(s,now+41000);assert.equal(s.status,'void');assert.equal(s.winner,null);assert.equal(s.finishReason,'materials_unavailable');});
