/* Disposable database CommonJS verification. */

// Real Nest HTTP against a disposable loopback PostgreSQL database; never uses an .env file.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),f=require('./lobby-evolution.cjs');
const root=require('node:path').resolve(__dirname,'../..');
const {boundedGrowth}=require(root+'/dist/src/common/growth-floor');
const {lockOwner}=require(root+'/dist/src/common/owner-lock');
async function state(i){return (await f.http(i,'GET','me')).partners;}
async function post(i,action,body,status=200){return f.http(i,'POST','me/partners/'+action,body,status);}
async function invariant(i){const p=await state(i),ledger=Number((await f.db.pool.query('SELECT sum(amount)::text n FROM hanq.growth_ledger WHERE user_id=$1',[f.users[i].id])).rows[0].n);assert.equal(p.totalPoints,ledger);assert.equal(p.items.reduce((n,d)=>n+d.points,0),ledger);assert.equal(p.items.filter(p=>p.equipped).length,1);return p;}
async function reward(i,n,key=randomUUID()) {return f.db.tx(async q=>{await lockOwner(q,f.users[i].id);const amount=await boundedGrowth(q,f.users[i].id,n);return q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,$2,'toeic-answer',$3,CURRENT_TIMESTAMP) ON CONFLICT(user_id,event_key) DO NOTHING",[f.users[i].id,'toeic-focus:'+key,amount]);});}
(async()=>{
 await f.start({maxMigration:51});
 // Existing XP above rookie is preserved, including explicit manual stage from 050.
 await f.points(0,199);await f.points(7,-1000);
 await f.db.pool.query("UPDATE hanq.partner_evolution SET stage=4,revision=7 WHERE user_id=$1 AND family='agumon'",[f.users[1].id]);
 const before=(await f.db.pool.query('SELECT count(*)::int n FROM hanq.growth_ledger')).rows[0].n;
 for(const file of ['052_owned_digimon.sql','053_battle_draw.sql','054_battle_site_presence.sql','055_coin_eggs_timed_hatch.sql'])await f.pg.exec(fs.readFileSync(root+'/migrations/'+file,'utf8'));
 assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM hanq.growth_ledger')).rows[0].n,before);
 let p=await invariant(0);assert.equal(p.items.length,1);assert.equal(p.totalPoints,1199);assert.equal(p.items[0].stage,2);assert.equal(p.items[0].family,'agumon');assert.deepEqual(p.availableFamilies,['gabumon','patamon']);
 const preserved=(await invariant(1)).items[0];assert.equal(preserved.stage,4);assert.equal(preserved.revision,7);assert.equal(preserved.points,1000);const zero=(await invariant(7)).items[0];assert.equal(zero.points,0);assert.equal(zero.stage,2);
 // Concurrent replay is exactly once; another request cannot claim this family twice.
 const requestId=randomUUID(),received=await Promise.all([0,1,2].map(()=>post(0,'claim',{family:'gabumon',requestId})));
 assert.equal(new Set(received.map(x=>x.partnerId)).size,1);assert.equal(received.filter(x=>!x.replayed).length,1);
 await post(0,'claim',{family:'patamon',requestId},409);
 await post(0,'claim',{family:'gabumon',requestId:randomUUID()},409);
 await post(0,'claim',{family:'patamon',requestId:randomUUID()});
 p=await invariant(0);assert.equal(p.items.length,3);assert(p.items.filter(x=>!x.firstPartner).every(x=>x.points===0&&x.stage===-1));
 // Two different simultaneous equips share collection revision; only one succeeds.
 const eggs=p.items.filter(x=>!x.firstPartner);
 const equips=await Promise.all(eggs.map(x=>fetch(f.origin+'/api/v1/me/partners/equip',{method:'POST',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json'},body:JSON.stringify({id:x.id,revision:p.revision,requestId:randomUUID()})})));
 assert.deepEqual(equips.map(x=>x.status).sort(),[200,409]);p=await invariant(0);const egg=p.items.find(x=>x.equipped),first=p.items.find(x=>x.firstPartner);
 await post(1,'equip',{id:egg.id,revision:p.revision,requestId:randomUUID()},404);
 const eggLobby=await f.enter(0),eggFighter=eggLobby.participants.find(x=>x.isMe),other=await f.enter(1);assert.equal(eggFighter.battleEligible,false);assert.equal(eggFighter.hp,0);await f.invite(0,other.myId,randomUUID(),409);await f.http(0,'POST','battle/practice',{family:'agumon',subject:'history',sessionId:f.users[0].sessionId},409);
 // Zero floor is per equipped partner; total account XP cannot be borrowed.
 assert.equal(await f.db.tx(q=>boundedGrowth(q,f.users[0].id,-1)),0);
 const rewardKey=randomUUID();await reward(0,-1);await reward(0,1,rewardKey);await reward(0,1,rewardKey);
 p=await invariant(0);assert.equal(p.items.find(x=>x.id===egg.id).points,1);assert.equal(p.items.find(x=>x.id===first.id).points,1199);
 await post(0,'evolve',{id:egg.id,revision:egg.revision,requestId:randomUUID()},409);
 for(let n=0;n<99;n++)await reward(0,1);
 // XP cannot hatch an egg; only 60 seconds of server time can.
 p=await invariant(0);assert.equal(p.items.find(x=>x.id===egg.id).stage,-1);f.advance(60000);p=await invariant(0);assert.equal(p.items.find(x=>x.id===egg.id).stage,0);
 p=await invariant(0);const evoKey=randomUUID(),equipRevision=p.revision;const evo=await Promise.all([0,1].map(()=>post(0,'equip',{id:egg.id,revision:equipRevision,requestId:evoKey})));
 assert.equal(evo.filter(x=>x.replayed).length,1);p=await invariant(0);assert.equal(p.items.find(x=>x.id===egg.id).stage,0);assert.equal(p.items.find(x=>x.id===egg.id).points,100);
 // Large surplus only advances one stage; concurrent revisions cannot skip stages.
 for(let n=0;n<1700;n++)await reward(0,1);
 const d=(await state(0)).items.find(x=>x.id===egg.id);
 const evolutions=await Promise.all([0,1].map(()=>fetch(f.origin+'/api/v1/me/partners/evolve',{method:'POST',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json'},body:JSON.stringify({id:egg.id,revision:d.revision,requestId:randomUUID()})})));
 assert.deepEqual(evolutions.map(x=>x.status).sort(),[200,409]);p=await invariant(0);assert.equal(p.items.find(x=>x.id===egg.id).stage,1);assert.equal(p.items.find(x=>x.id===egg.id).points,1800);
 // Replaying an old successful command after other changes never re-equips/re-evolves.
 await post(0,'equip',{id:egg.id,revision:equipRevision,requestId:evoKey});assert.equal((await state(0)).items.find(x=>x.id===egg.id).stage,1);
 // Hall ranks by the sum of owned XP but shows the equipped form, never a form invented from the sum.
 const {HallService}=require(root+'/dist/src/profile/hall-of-fame');const ranking=await new HallService(f.db).list(f.users[0].id,{});assert.equal(ranking.me.points,p.totalPoints);assert.equal(ranking.me.character.id,p.items.find(x=>x.equipped).character);
 // Two unique requests racing to claim same egg.
 const claims=await Promise.all([0,1].map(()=>fetch(f.origin+'/api/v1/me/partners/claim',{method:'POST',headers:{Authorization:'Bearer '+f.users[2].token,'Content-Type':'application/json'},body:JSON.stringify({family:'patamon',requestId:randomUUID()})})));
 assert.deepEqual(claims.map(x=>x.status).sort(),[200,409]);await invariant(2);
 // Equip vs XP grants serialize on the same owner lock (the reward belongs to one, never both).
 p=await state(0);const totalBefore=p.totalPoints;
 await Promise.all([post(0,'equip',{id:first.id,revision:p.revision,requestId:randomUUID()}),reward(0,1)]);p=await invariant(0);assert.equal(p.totalPoints,totalBefore+1);
 // Real battle invitation freezes equip and evolve before seats exist.
 await f.enter(0);const target=await f.enter(1);await f.invite(0,target.myId);
 await post(0,'equip',{id:egg.id,revision:p.revision,requestId:randomUUID()},409);
 await post(0,'evolve',{id:first.id,revision:p.items.find(x=>x.id===first.id).revision,requestId:randomUUID()},409);
 // Signup after migration: exactly one first partner starts at 1000; trigger never duplicates bonus.
 const newUser=randomUUID();await f.db.pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,$2,$2,'$argon2id$synthetic','new',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[newUser,'new-'+newUser+'@example.test']);
 await f.db.pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,'signup','signup',1000,CURRENT_TIMESTAMP)",[newUser]);
 const fresh=(await f.db.pool.query('SELECT * FROM hanq.owned_digimon WHERE user_id=$1',[newUser])).rows;assert.equal(fresh.length,1);assert.equal(Number(fresh[0].xp),1000);assert.equal(fresh[0].stage,2);
 // Constraints independently reject double equip and non-equipped XP attribution.
 await assert.rejects(()=>f.db.pool.query('UPDATE hanq.owned_digimon SET equipped=true WHERE user_id=$1',[f.users[0].id]));
 await assert.rejects(()=>f.db.pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,digimon_id,created_at) VALUES($1,$2,'toeic-answer',1,$3,CURRENT_TIMESTAMP)",[f.users[0].id,randomUUID(),egg.id]));
 console.log(JSON.stringify({pass:true,db:process.env.NATIVE_PG_URL?'native PostgreSQL independent transactions':'PGlite',migration:'exact opening XP, no ledger edits or grants',signup:'one rookie,1000 XP',claims:'same-key replay,distinct-key race,no duplication',equip:'one equipped,stale revision rejected,owner isolation',growth:'equipped only,per-partner zero floor,sum invariant,duplicate reward,concurrent equip',evolution:'threshold,one step,surplus,retry,concurrent revision',battle:'egg challenge/practice blocked, zero lobby stats; pending invitation blocks equip/evolve'},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>f.close());
