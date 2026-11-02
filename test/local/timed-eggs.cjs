/* Real Nest + disposable PostgreSQL verification. */

const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),f=require('./lobby-evolution.cjs');
const {lockOwner}=require('../../dist/src/common/owner-lock'),{attendance}=require('../../dist/src/portal/member-state');
const state=i=>f.http(i,'GET','me/partners'),post=(i,action,body,status=200)=>f.http(i,'POST','me/partners/'+action,body,status);
const item=(p,id)=>p.items.find(d=>d.id===id);
async function fingerprint(){return(await f.db.pool.query("SELECT md5(string_agg(row_to_json(g)::text,'|' ORDER BY user_id,event_key)) value FROM hanq.growth_ledger g")).rows[0].value;}
async function invariant(i){const p=await state(i),xp=Number((await f.db.pool.query('SELECT sum(amount)::text xp FROM hanq.growth_ledger WHERE user_id=$1',[f.users[i].id])).rows[0].xp);assert.equal(p.totalPoints,xp);assert.equal(p.items.reduce((n,d)=>n+d.points,0),xp);assert.equal(p.items.filter(d=>d.equipped).length,1);return p;}
(async()=>{
 await f.start({maxMigration:54});const before=await fingerprint(),sql=fs.readFileSync('migrations/055_coin_eggs_timed_hatch.sql','utf8');
 // Transactional schema failure/rollback leaves all ownership and old ledger rows intact.
 const connection=await f.db.pool.connect();try{await connection.query('BEGIN');await connection.query(sql);await connection.query('ROLLBACK');}finally{connection.release();}
 assert.equal((await f.db.pool.query("SELECT to_regclass('hanq.shop_products') value")).rows[0].value,null);assert.equal(await fingerprint(),before);
 await f.pg.exec(sql);assert.equal(await fingerprint(),before);
 let p=await state(0);assert(p.purchaseEnabled&&p.hatchEnabled);assert.equal(p.coinBalance,0);assert(p.products.every(p=>p.priceCoin===0));
 const product=p.products[0];assert.equal(product.family,'gabumon');
 for(const priceCoin of [1,-1,'0',null])await post(0,'claim',{family:'gabumon',priceCoin,requestId:randomUUID()},400);
 assert.equal((await state(0)).items.length,1);
 const key=randomUUID(),receipts=await Promise.all(Array.from({length:4},()=>post(0,'claim',{family:'gabumon',priceCoin:0,requestId:key})));
 const eggId=receipts[0].partnerId;assert.equal(receipts.filter(r=>!r.replayed).length,1);assert.equal(new Set(receipts.map(r=>r.partnerId)).size,1);assert(receipts.every(r=>r.priceCoin===0&&r.currency==='Coin'));
 await post(0,'claim',{family:'patamon',priceCoin:0,requestId:key},409);await post(0,'claim',{family:'gabumon',priceCoin:0,requestId:randomUUID()},409);
 p=await invariant(0);const first=p.equippedId;assert.equal(item(p,eggId).hatchStartedAt,null);assert.equal(item(p,eggId).points,0);assert.equal(item(p,eggId).eligible,false);assert.equal(item(p,eggId).nextThreshold,null);assert.equal(p.products.find(x=>x.family==='gabumon').owned,true);
 // A different signed-in owner cannot operate on or see this egg.
 await post(1,'equip',{id:eggId,revision:p.revision,requestId:randomUUID()},404);assert(!(await state(1)).items.some(d=>d.id===eggId));
 const equipKey=randomUUID(),equipRevision=p.revision,equipped=await post(0,'equip',{id:eggId,revision:equipRevision,requestId:equipKey});
 assert.equal(Date.parse(equipped.hatchReadyAt)-Date.parse(equipped.hatchStartedAt),60000);const start=equipped.hatchStartedAt,ready=equipped.hatchReadyAt;
 await post(0,'equip',{id:first,revision:0,requestId:randomUUID(),serverNow:ready},400);
 // Attendance during the egg interval is awarded exactly once to that egg.
 const checkin=()=>f.db.tx(q=>attendance(q,f.users[0].id,()=>new Date(start),true));await Promise.all([checkin(),checkin()]);
 p=await invariant(0);assert.equal(item(p,eggId).points,10);assert.equal(item(p,first).points,1000);
 await f.db.tx(async q=>{await lockOwner(q,f.users[0].id);await q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,$2,'toeic-answer',1,CURRENT_TIMESTAMP)",[f.users[0].id,'toeic-focus:'+randomUUID()]);});
 p=await invariant(0);assert.equal(item(p,eggId).points,11);
 await post(0,'evolve',{id:eggId,revision:item(p,eggId).revision,requestId:randomUUID()},409);
 f.advance(30000);p=await state(0);await post(0,'equip',{id:first,revision:p.revision,requestId:randomUUID()});
 f.advance(29999);p=await state(0);assert.equal(item(p,eggId).stage,-1);assert.equal(item(p,eggId).hatchReadyAt,ready);
 // The selected egg keeps its server deadline across reselect/reload/absence.
 await post(0,'equip',{id:eggId,revision:p.revision,requestId:randomUUID()});p=await state(0);assert.equal(item(p,eggId).hatchStartedAt,start);assert.equal(item(p,eggId).stage,-1);
 f.advance(1);const snapshots=await Promise.all([state(0),f.http(0,'GET','me').then(x=>x.partners),state(0)]);assert(snapshots.every(x=>item(x,eggId).stage===0));p=await invariant(0);assert.equal(item(p,eggId).hatchedAt,ready);assert.equal(item(p,eggId).points,11);assert.equal(item(p,eggId).nextThreshold,500);
 // Lost initial response replay returns its immutable receipt without restarting/re-equipping.
 const replay=await post(0,'equip',{id:eggId,revision:equipRevision,requestId:equipKey});assert(replay.replayed);assert.equal(replay.stage,-1);assert.equal(item(await state(0),eggId).stage,0);
 const second=await post(0,'claim',{family:'patamon',priceCoin:0,requestId:randomUUID()});p=await state(0);await post(0,'equip',{id:second.partnerId,revision:p.revision,requestId:randomUUID()});p=await state(0);const offlineReady=item(p,second.partnerId).hatchReadyAt;await post(0,'equip',{id:first,revision:p.revision,requestId:randomUUID()});f.advance(600000);p=await invariant(0);assert.equal(item(p,second.partnerId).stage,0);assert.equal(item(p,second.partnerId).hatchedAt,offlineReady);assert.equal(item(p,second.partnerId).points,0);assert.equal(item(p,first).points,1000);assert.equal(p.coinBalance,0);
 // Catalog and ownership DB constraints independently reject charging or cross-family ownership.
 await assert.rejects(()=>f.db.pool.query('UPDATE hanq.shop_products SET price_coin=1'));
 await assert.rejects(()=>f.db.pool.query("UPDATE hanq.owned_digimon SET product_id='egg-patamon' WHERE id=$1",[eggId]));
 assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM hanq.digimon_commands WHERE user_id=$1 AND command='claim'",[f.users[0].id])).rows[0].n,2);
 console.log(JSON.stringify({pass:true,db:'isolated native PostgreSQL',migration:'transactional rollback tested; old ledgers byte fingerprint preserved',purchase:'zero price validation,parallel idempotency,once per family,receipts',hatch:'59999/60000ms server boundary,reselect,reload,offscreen completion,concurrent readers,immutable retry',growth:'attendance once to equipped egg,quiz reward retained,sum preserved,first1000 unchanged',ownerIsolation:true},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>f.close());
