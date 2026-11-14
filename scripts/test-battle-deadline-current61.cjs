'use strict';
// Local SQL regression only: exact61 synthetic database, no production DB, Windows, or schema edits.
// npm run build; HANQ_BATTLE_LOCAL_PG=1 node --test scripts/test-battle-deadline-current61.cjs
// Requires a NEW owned loopback PostgreSQL DB hanq_pvp_deadline_test on port 55481; no env DB URL is read.
const A=require('node:assert/strict'),{before,after,test}=require('node:test');
const {readFileSync}=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events'),{setImmediate:immediate}=require('node:timers/promises');
const {BattleService}=require('../dist/src/battle/service'),{BattleStream}=require('../dist/src/battle/stream');
const {fighter,roundDuration}=require('../dist/src/battle/rules'),{migrate}=require('../dist/src/db/migrator');
const C=require('./current-runtime-contract.cjs'),F=require('./current-runtime-schema-fixture.cjs');
A.equal(process.env.HANQ_BATTLE_LOCAL_PG,'1','explicit isolated local test opt-in required');
let pg,db,holdNext=null;
const root=path.resolve(__dirname,'..'),fixture=path.join(root,'ops-prep/current-runtime-test-fixtures/runtime61');
before(async()=>{
 const {Pool}=require('pg');pg=new Pool({host:'127.0.0.1',port:55481,user:'agent',database:'hanq_pvp_deadline_test',max:10,connectionTimeoutMillis:2000});const q=pg;
 A.deepEqual((await q.query("SELECT current_database() db,host(inet_server_addr()) host,inet_server_port() port")).rows,[{db:'hanq_pvp_deadline_test',host:'127.0.0.1',port:55481}]);
 A.equal((await q.query("SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name='hanq'")).rows[0].n,0,'a fresh owned synthetic database is required');
 const manifest=JSON.parse(readFileSync(path.join(fixture,'schema.json'),'utf8'));
 const loaded=F.loadExactSql(manifest,path.join(fixture,'sql'));
 A.equal(loaded.rows.length,61);A.equal(loaded.contract.manifestSha256,C.LEDGER);
 // Feed the unmodified migrator an exact-byte directory with its required repeatable privileges path.
 const fs=require('node:fs'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hanq-pvp-exact61-'));fs.mkdirSync(path.join(dir,'repeatable'));
 for(const row of loaded.rows)fs.writeFileSync(path.join(dir,row.version),row.bytes);
 fs.copyFileSync(path.join(fixture,'privileges.sql'),path.join(dir,'repeatable/privileges.sql'));
 const migration=await migrate(pg,dir);A.equal(migration.applied.length,61);
 A.deepEqual((await q.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,loaded.contract.rows);
 db={pool:q,tx:async fn=>{const pause=holdNext;holdNext=null;if(pause){pause.enter();await pause.wait;}const {DbService}=require('../dist/src/db/db.service');return DbService.prototype.tx.call({pool:pg},fn);}};
 console.log('exact61='+C.LEDGER+'; '+(await q.query('SELECT version() v')).rows[0].v);
});
after(async()=>{if(pg)await pg.end();});
function bundle(part=0,count=1,durationMs=30000){return {key:'synthetic',version:'fixture-v1',part,prompt:'synthetic',passage:null,
 items:Array.from({length:count},(_,i)=>({id:String(i+1),number:i+1,prompt:'synthetic',choices:[{id:'A',text:'A'},{id:'B',text:'B'}],answer:'A',explanation:'synthetic'})),durationMs,audio:null,images:[]};}
async function create({subject='history',practice=false,count=1,durationMs=30000,hp=50}={}){
 const clock={t:1800000000000,now(){return new Date(this.t);}},users=[randomUUID(),randomUUID()],id=randomUUID();
 for(const user of users){await db.pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,$2,$2,'$argon2id$synthetic','synthetic',$3,$3,$3)",[user,user+'@example.test',clock.now()]);
 await db.pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,'signup','signup',1000,$2)",[user,clock.now()]);}
 const bank=[bundle(subject==='history'?0:5,count,durationMs)],fighters={left:fighter('synthetic',0,'agumon'),right:fighter('synthetic',0,'agumon')};fighters.left.hp=fighters.right.hp=hp;
 const state={practice,archiveVersion:1,background:'ice',status:'ready',fighters,index:0,ready:{left:false,right:practice},last:{left:clock.t,right:clock.t},start:null,deadline:null,created:clock.t,phaseAt:clock.t,submissions:{left:null,right:null},result:null,grace:null,winner:null,finishReason:null,revision:1,luk:[1,3,5,7,9,11],mediaErrors:0,connectionGap:false,mediaServed:{left:false,right:practice}};
 if(practice)await db.pool.query("INSERT INTO hanq.battle_practice_matches(id,owner_id,status,state,question_bank,created_at,expires_at,subject) VALUES($1,$2,'ready',$3::jsonb,$4::jsonb,$5,$6,$7)",[id,users[0],JSON.stringify(state),JSON.stringify(bank),clock.now(),new Date(clock.t+10000),subject]);
 else{await db.pool.query("INSERT INTO hanq.battle_matches(id,challenger,opponent,subject,status,state,question_bank,created_at,expires_at) VALUES($1,$2,$3,$4,'ready',$5::jsonb,$6::jsonb,$7,$8)",[id,...users,subject,JSON.stringify(state),JSON.stringify(bank),clock.now(),new Date(clock.t+10000)]);
 await db.pool.query('INSERT INTO hanq.battle_seats(user_id,match_id) VALUES($1,$3),($2,$3)',[...users,id]);}
 const service=new BattleService(db,clock,()=>.99);
 const act=(side,action,data)=>service.act(users[side==='left'?0:1],id,action,data);
 await act('left','ready',{round:1});const initial=practice?await act('left','poll'):await act('right','ready',{round:1});
 clock.t=initial.start+100;
 return {clock,users,id,service,act,initial,answer:(side,optionId='A',item='1')=>act(side,'answer',{round:1,answers:[{id:item,optionId}]}),saved:async()=>{
 const table=practice?'battle_practice_matches':'battle_matches';return(await db.pool.query('SELECT state FROM hanq.'+table+' WHERE id=$1',[id])).rows[0].state;
 }};
}
const error=code=>e=>e.code===code;
test('base duration is current +30s only for history PvP, including nonstandard fixture durations',async()=>{
 A.equal(roundDuration(bundle()),60000);A.equal(roundDuration(bundle(0,1,42000)),72000);
 for(const part of [1,2,3,4,5,6,7])A.equal(roundDuration(bundle(part,3,123456)),123456);
 A.equal(roundDuration(bundle(),true),30000);
 const f=await create();A.equal(f.initial.deadline-f.initial.start,60000);A.equal(f.initial.question.durationMs,60000);
 const start=await f.act('left','poll');A.equal(start.deadline,f.initial.deadline);A(!JSON.stringify(start.question).includes('explanation'));A(!JSON.stringify(start.question).includes('"answer"'));
});
test('a first valid receipt changes both views to receipt +5s and survives restart/reconnect',async()=>{
 const f=await create(),received=f.clock.t,signals=[];f.service.events.on('change',ids=>signals.push(ids));
 const a=await f.answer('left');A.equal(a.deadline,received+5000);A.deepEqual(signals.at(-1),f.users);
 f.clock.t+=1000;const restarted=new BattleService(db,f.clock,()=>.99),b=await restarted.act(f.users[1],f.id,'poll');
 A.equal(b.deadline,a.deadline);A.equal(b.revision>a.revision,true);A.deepEqual(b.locked,{left:['1'],right:[]});A.deepEqual(b.myAnswers,[]);
 A(!JSON.stringify(b.question).includes('"answer"'));A.equal((await f.saved()).deadline,a.deadline);
});
test('wrong but valid first answers also start the shared 5s cutoff; duplicates never move it',async()=>{
 const f=await create(),a=await f.answer('left','B');f.clock.t+=3000;
 const retry=await f.answer('left','B');A.equal(retry.deadline,a.deadline);A.equal((await f.saved()).submissions.left.answers[0].at,a.serverNow);
 await A.rejects(f.answer('left','A'),error('battle_answer_locked'));A.equal((await f.saved()).deadline,a.deadline);
 f.clock.t=a.deadline+1;const lateRetry=await f.answer('left','B');A.equal(lateRetry.deadline,a.deadline);A.equal(lateRetry.status,'between');
});
test('invalid, empty, repeated item and pre-start submissions cannot set a deadline',async()=>{
 const f=await create(),before=f.initial.deadline;
 for(const answers of [[],[{id:'missing',optionId:'A'}],[{id:'1',optionId:'Z'}],[{id:'1',optionId:'A'},{id:'1',optionId:'A'}]])await A.rejects(f.act('left','answer',{round:1,answers}),error('battle_invalid_answer'));
 f.clock.t=f.initial.start-1;await A.rejects(f.answer('left'),error('battle_answer_closed'));
 A.equal((await f.saved()).deadline,before);A.deepEqual((await f.saved()).submissions,{left:null,right:null});
});
test('the old base deadline wins if first valid receipt has less than 5s remaining',async()=>{
 for(const remaining of [5000,4999,1]){const f=await create();f.clock.t=f.initial.deadline-remaining;const a=await f.answer('left');A.equal(a.deadline,f.initial.deadline);}
 const f=await create();f.clock.t=f.initial.deadline;await A.rejects(f.answer('left'),error('battle_answer_closed'));A.equal((await f.saved()).deadline,f.initial.deadline);
});
test('one millisecond before the shortened deadline is accepted, equal/after is rejected',async()=>{
 const f=await create(),a=await f.answer('left');f.clock.t=a.deadline-1;const b=await f.answer('right');A.equal(b.status,'between');A.equal(b.result.events[0].reason,'faster_correct');A.equal(b.result.events[0].attacker,'left');
 for(const offset of [0,1]){const g=await create(),d=await g.answer('left');g.clock.t=d.deadline+offset;await A.rejects(g.answer('right'),error('battle_answer_closed'));A.equal((await g.saved()).deadline,d.deadline);const done=await g.act('right','poll');A.equal(done.status,'between');A.equal(done.result.rightCorrect,0);}
});
test('partial additions and retries cannot reset the first global cutoff or receipt ordering',async()=>{
 const f=await create({count:2}),a=await f.answer('left');f.clock.t+=2000;const add=await f.answer('left','A','2');A.equal(add.deadline,a.deadline);
 f.clock.t+=1000;const b=await f.answer('right','B');A.equal(b.deadline,a.deadline);A.equal(b.status,'playing');
 f.clock.t=a.deadline;const done=await f.act('left','poll');A.equal(done.result.leftCorrect,2);A.equal(done.result.rightCorrect,0);A.deepEqual(done.result.events.map(e=>e.attacker),['left','left']);
});
test('concurrent duplicate and opponent requests serialize without extending deadline or duplicating answers',async()=>{
 const f=await create();const [a,b,c]=await Promise.all([f.answer('left'),f.answer('left'),f.answer('right')]);
 A.equal(a.deadline,b.deadline);A.equal(c.deadline,a.deadline);A.equal(c.status,'between');A.equal(c.result.events[0].reason,'simultaneous');A.deepEqual(c.result.hp,{left:50,right:50});
 const s=await f.saved();A.equal(s.submissions.left.answers.length,1);A.equal(s.submissions.right.answers.length,1);
});
test('earlier receipt waiting before transaction still tightens a later committed cutoff',async()=>{
 const f=await create({count:2}),first=f.clock.t;let release,entered;
 const wait=new Promise(r=>{release=r;}),entry=new Promise(r=>{entered=r;});holdNext={wait,enter:entered};
 const early=f.answer('left');await entry;f.clock.t+=1000;const later=await f.answer('right');A.equal(later.deadline,first+6000);
 release();const result=await early;A.equal(result.deadline,first+5000);A.equal((await f.saved()).submissions.left.answers[0].at,first);
});
test('queued valid receipt uses server receipt time even if execution passes its 5s window',async()=>{
 const f=await create(),first=f.clock.t;let release,entered;const wait=new Promise(r=>{release=r;}),entry=new Promise(r=>{entered=r;});holdNext={wait,enter:entered};
 const pending=f.answer('left');await entry;f.clock.t+=6000;release();const done=await pending;A.equal(done.deadline,first+5000);A.equal(done.status,'between');A.equal(done.result.leftCorrect,1);
});
test('accuracy overrides first receipt; exact ties, unanswered timeout and next rounds retain their rules',async()=>{
 const f=await create();await f.answer('left','B');f.clock.t+=1;const win=await f.answer('right');A.equal(win.result.events[0].attacker,'right');A.equal(win.result.events[0].reason,'one_correct');
 const g=await create();g.clock.t=g.initial.deadline;const timeout=await g.act('left','poll');A.equal(timeout.result.events[0].kind,'weak');A.deepEqual(timeout.result.hp,{left:49,right:49});
 g.clock.t+=Math.max(4000,timeout.result.presentationMs);g.service.connected(g.users[0],true);g.service.connected(g.users[1],true);
 const next=await g.act('left','poll');A.equal(next.round,2);A.equal(next.deadline-next.start,60000);A.deepEqual(next.locked,{left:[],right:[]});
});
test('double KO stays an XP-free draw and shortened-timeout wins settle XP exactly once',async()=>{
 const draw=await create({hp:1});draw.clock.t=draw.initial.deadline;const d=await draw.act('left','poll');A.equal(d.finishReason,'double_ko');A.equal(d.status,'finished');A.equal(d.winner,null);A.equal(d.reward.delta,0);
 await draw.act('right','poll');A.equal((await db.pool.query('SELECT count(*)::int n FROM hanq.battle_xp_ledger WHERE match_id=$1',[draw.id])).rows[0].n,2);
 A.equal((await db.pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE battle_match_id=$1",[draw.id])).rows[0].n,0);
 const win=await create({hp:5}),before=(await db.pool.query("SELECT user_id,event_key,amount FROM hanq.growth_ledger WHERE user_id=ANY($1::uuid[]) AND kind<>'battle' ORDER BY user_id,event_key",[win.users])).rows;
 const first=await win.answer('left');win.clock.t=first.deadline;const ended=await win.act('right','poll');A.equal(ended.winner,'left');A.equal(ended.reward.delta,-100);
 await win.act('left','poll');await win.answer('left');
 const rewards=(await db.pool.query('SELECT user_id,applied_delta FROM hanq.battle_xp_ledger WHERE match_id=$1',[win.id])).rows;A.equal(rewards.length,2);A.equal(rewards.find(r=>r.user_id===win.users[0]).applied_delta,100);A.equal(rewards.find(r=>r.user_id===win.users[1]).applied_delta,-100);
 A.deepEqual((await db.pool.query("SELECT user_id,event_key,amount FROM hanq.growth_ledger WHERE user_id=ANY($1::uuid[]) AND kind<>'battle' ORDER BY user_id,event_key",[win.users])).rows,before);
 A.deepEqual((await db.pool.query('SELECT xp::int xp FROM hanq.owned_digimon WHERE user_id=ANY($1::uuid[]) ORDER BY xp',[win.users])).rows,[{xp:900},{xp:1100}]);
 A.equal((await db.pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE battle_match_id=$1',[win.id])).rows[0].n,2);
});
test('TOEIC and history bot practice keep original duration, deadline and bot rules',async()=>{
 const toeic=await create({subject:'toeic',durationMs:90000}),base=toeic.initial.deadline;A.equal(base-toeic.initial.start,90000);const a=await toeic.answer('left');A.equal(a.deadline,base);
 const practice=await create({practice:true});A.equal(practice.initial.deadline-practice.initial.start,30000);const p=await practice.answer('left');A.equal(p.deadline,practice.initial.deadline);A.equal(p.status,'between');A.equal(p.practice,true);
});
test('native concurrent submissions wait on the existing PostgreSQL lobby advisory lock',async()=>{
 const f=await create(),first=f.clock.t,blocker=await pg.connect();
 await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtext('hanq.battle.lobby'))");
 let a,b;
 try{
  a=f.answer('left');
  for(let i=0;i<100;i++){const waiting=await pg.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'");if(waiting.rows[0].n>0)break;await immediate();if(i===99)A.fail('expected actual PostgreSQL advisory lock wait');}
  f.clock.t+=1000;b=f.answer('right');await blocker.query('COMMIT');
  const [left,right]=await Promise.all([a,b]);A.equal(left.deadline,first+5000);A.equal(right.deadline,first+5000);A.equal(right.result.events[0].attacker,'left');
 }finally{await blocker.query('ROLLBACK');blocker.release();}
});
async function until(check){for(let i=0;i<10000;i++){if(check())return;await immediate();}A.fail('stream did not settle');}
function response(){return Object.assign(new EventEmitter(),{destroyed:false,writableLength:0,chunks:[],status(){return this;},setHeader(){},flushHeaders(){},write(s){this.chunks.push(s);},end(){this.destroyed=true;}});}
function snapshots(res){return res.chunks.filter(x=>x.startsWith('event: snapshot\n')).map(x=>JSON.parse(x.split('\ndata: ')[1]));}
test('existing stream delivers the new deadline to both players and rearms the exact expiry timer',async t=>{
 const f=await create();t.mock.timers.enable({apis:['setTimeout','Date'],now:f.clock.t});
 const stream=new BattleStream(f.service,{authenticate:async token=>({userId:token})}),responses=f.users.map(()=>response());
 t.after(()=>stream.onModuleDestroy());
 f.users.forEach((user,i)=>stream.open(user,user,new EventEmitter(),responses[i]));
 await until(()=>responses.every(r=>snapshots(r).length));A.equal(stream.timers.get(f.id).at,f.initial.deadline);
 const answer=await f.answer('left');await until(()=>responses.every(r=>snapshots(r).at(-1).deadline===answer.deadline));
 A.equal(stream.timers.get(f.id).at,answer.deadline);for(const r of responses)A.equal(snapshots(r).at(-1).status,'playing');
 f.clock.t=answer.deadline-1;t.mock.timers.tick(4999);await immediate();A.equal((await f.saved()).status,'playing');
 f.clock.t=answer.deadline+10;t.mock.timers.tick(11);await until(()=>responses.every(r=>snapshots(r).at(-1).status==='between'));
 for(const r of responses){const d=snapshots(r).at(-1);A.equal(d.deadline,answer.deadline);A.equal(d.result.leftCorrect,1);A.equal(d.result.rightCorrect,0);}
});
