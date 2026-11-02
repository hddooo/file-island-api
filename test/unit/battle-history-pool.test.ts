import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Queryable} from '../../src/db/db.service';
import {bundles} from '../../src/battle/questions';
import {recordQuery} from '../../src/attempts/my-records';
import {BattleService} from '../../src/battle/service';
const choices=Array.from({length:5},(_,i)=>({id:'o'+i,text:String(i+1)}));
test('history mixes quiz and mock while preserving image choice order, common material and answer',async()=>{
 const q={query:async(_sql:string,args:string[])=>({rows:args[0]==='quiz'?Array.from({length:8},(_,i)=>({question_id:'quiz'+i,version:'v',public_payload:{prompt:'synthetic quiz '+i,options:choices.slice(0,4)},correct_option_id:'o2',review_payload:{why:'fixture'}})):[{question_id:'exam-72-47',version:'v',public_payload:{exam:72,number:47,image:'media/exam-expanded/72-47.webp',commonImage:'media/exam-expanded/72-common47-48.webp',options:choices},correct_option_id:'o3',review_payload:{overview:{reason:['synthetic reason']}}}]})} as unknown as Queryable;
 const bank=await bundles(q,'history');assert.equal(bank.length,9);assert(bank.slice(0,2).some(b=>b.key==='exam-72-47'));const mock=bank.find(b=>b.key==='exam-72-47')!;assert.deepEqual(mock.items[0].choices,choices);assert.equal(mock.items[0].answer,'o3');assert.equal(mock.durationMs,30000);assert.equal(mock.images.length,2);assert.equal(mock.items[0].explanation,'synthetic reason');assert.equal(bank.find(b=>b.key==='quiz0')!.items[0].choices.length,4);
});
test('record filters reject unsafe input and support actual source semantics',()=>{assert.equal(recordQuery({}).subject,'all');for(const x of [{subject:'sql'},{source:'island'},{page:0},{page:'1.5'},{page:Infinity}])assert.throws(()=>recordQuery(x));});
test('next history image round waits for both image preparation acknowledgments',()=>{const service=new BattleService({} as never,{now:()=>new Date(100000)},()=>.99);const s={status:'between',index:0,phaseAt:90000,result:{presentationMs:8000,events:[]},last:{left:100000,right:100000},grace:null,connectionGap:false,bank:[{audio:null,durationMs:30000},{part:0,audio:null,images:['media/exam/70-02.webp'],durationMs:60000}],submissions:{left:{answers:[]},right:{answers:[]}},ready:{left:true,right:true},mediaServed:{left:true,right:true},start:1,deadline:2};(service as unknown as {advance(s:unknown,n:number,g:boolean):void}).advance(s,100000,false);assert.equal(s.status,'ready');assert.equal(s.start,null);assert.deepEqual(s.ready,{left:false,right:false});});

test('mock live payload hides answer and explanation for both sides including reconnect snapshots',()=>{
 const svc=new BattleService({} as never,{now:()=>new Date(100000)},()=>.99);
 const bundle={part:0,key:'exam-72-47',version:'v',prompt:'실전 모의고사',images:['media/exam-expanded/72-47.webp','media/exam-expanded/72-common47-48.webp'],audio:null,passage:null,durationMs:30000,items:[{id:'1',number:47,prompt:'실전 모의고사',choices,answer:'o3',explanation:'SECRET EXPLANATION'}]};
 const state={status:'ready',bank:[bundle],index:0,practice:false,phaseAt:100000,start:null,deadline:null,ready:{left:true,right:false},last:{left:100000,right:100000},grace:null,submissions:{left:null,right:null},fighters:{left:{hp:100},right:{hp:100}},result:null,revision:1};
 const match={id:'synthetic',subject:'history',state,created_at:new Date(100000),expires_at:new Date(200000)};
 const view=svc as unknown as {view(m:unknown,s:'left'|'right',n:number):{question:{images:string[];items:{choices:unknown[]}[]};deadline:number;start:number};advance(s:unknown,n:number,g:boolean):void};
 for(const side of ['left','right'] as const){const d=view.view(match,side,100000);assert(!JSON.stringify(d.question).includes('answer'));assert(!JSON.stringify(d.question).includes('SECRET'));assert.equal(d.question.items[0].choices.length,5);assert.equal(d.question.images.length,2);}
 assert.equal(state.start,null);state.ready.right=true;view.advance(state,100000,false);const left=view.view(match,'left',100001),right=view.view(match,'right',100050);assert.equal(left.start,right.start);assert.equal(left.deadline,right.deadline);assert.equal(left.deadline-left.start,30000);
});

test('image preparation has one bounded timeout, no timer starts from one acknowledgment, and disconnect grace stays bounded',()=>{
 const svc=new BattleService({} as never,{now:()=>new Date(100000)},()=>.99) as unknown as {advance(s:unknown,n:number,g:boolean):void};
 function state(){return{status:'ready',index:0,phaseAt:100000,bank:[{part:0,images:['media/exam/70-02.webp'],audio:null,durationMs:30000}],start:null,deadline:null,ready:{left:true,right:false},last:{left:100000,right:100000},grace:null,submissions:{left:null,right:null},fighters:{left:{hp:100},right:{hp:100}},winner:null};}
 const waiting=state();svc.advance(waiting,120000,false);assert.equal(waiting.start,null);assert.equal(waiting.deadline,null);svc.advance(waiting,160001,false);assert.equal(waiting.status,'void');assert.equal((waiting as unknown as {finishReason:string}).finishReason,'materials_unavailable');
 const disconnected={...state(),index:1,bank:[{part:0,images:[],audio:null,durationMs:30000},{part:0,images:['media/exam/70-02.webp'],audio:null,durationMs:30000}],last:{left:100000,right:90000}};svc.advance(disconnected,100000,false);const end=(disconnected.grace as unknown as {end:number}).end;svc.advance(disconnected,101000,false);assert.equal((disconnected.grace as unknown as {end:number}).end,end);assert.equal(disconnected.deadline,null);
});
