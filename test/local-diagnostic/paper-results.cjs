// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {migrate}=require('../../dist/src/db/migrator.js');
const {PaperResultsService}=require('../../dist/src/cbt/paper-results.service.js');
const db=new PGlite();
const q={async query(sql,args){if(args){const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};}return (await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
const tx=async f=>{await q.query('BEGIN');try{const r=await f(q);await q.query('COMMIT');return r;}catch(e){await q.query('ROLLBACK');throw e;}};
const root=path.resolve(__dirname,'../..');
(async()=>{
 const first=await migrate({connect:async()=>q},path.join(root,'migrations'));assert.equal(first.applied.at(-1),'069_paper_exam_results.sql');
 const second=await migrate({connect:async()=>q},path.join(root,'migrations'));assert.equal(second.applied.length,0);
 const owner=randomUUID(),other=randomUUID(),now=new Date('2026-01-01T00:00:00Z');
 for(const [id,email] of [[owner,'paper-a@example.invalid'],[other,'paper-b@example.invalid']])await q.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,$2,$2,'$argon2id$fixture','fixture',$3,$3,$3)",[id,email,now]);
 const rounds={72:[2,6,15,28,47],73:[1,2,3,4]};
 const dataFile=process.env.PAPER_EXAM_POOL;assert.ok(dataFile,'Set PAPER_EXAM_POOL to the verified frontend exam-pool.js');
 let pool=JSON.parse(fs.readFileSync(dataFile,'utf8').split('window.HANQ_EXAM_POOL=')[1].trim().replace(/;$/,'' )).questions;
 if(Array.isArray(pool))pool=Object.fromEntries(pool.map(x=>[x.id,x]));
 for(const round of [72,73])for(let n=1;n<=50;n++){
  const id=`exam-${round}-${String(n).padStart(2,'0')}`,v=pool[id],options=Array.from({length:5},(_,k)=>`${id}-option-${k+1}`);
  await q.query(`INSERT INTO hanq.question_versions(question_id,version,kind,is_current,era,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,'fixture-original','mock',true,'samguk',$2,$3,$4,$5,$6,$7,'{}',$8,$9)`,[id,round,n,v.points,options,options[v.answer-1],JSON.stringify(n===47&&round===72?{commonImage:'72-common47-48.webp'}:{}),'a'.repeat(64),now]);
 }
 const before={};for(const t of ['cbt_runs','attempts','growth_ledger','manual_wrong_notes','attendance'])before[t]=(await q.query('SELECT count(*)::int n FROM hanq.'+t)).rows[0].n;
 const assets={read:async name=>Buffer.from(name)};
 const svc=new PaperResultsService({pool:q,tx},{now:()=>now},assets),ids=[];
 for(const r of [72,73]){
  const dto={examRound:r,wrongNumbers:rounds[r],idempotencyKey:`paper-fixture-${r}`,completed:true};
  const a=await svc.create(owner,dto);ids.push(a.result.id);assert.equal(a.result.score,100-rounds[r].reduce((p,n)=>p+pool[`exam-${r}-${String(n).padStart(2,'0')}`].points,0));assert.equal(a.result.wrongCount,rounds[r].length);assert.equal(a.result.selectedAnswersKnown,false);
  const retry=await svc.create(owner,{...dto,wrongNumbers:[...dto.wrongNumbers].reverse()});assert.equal(retry.result.id,a.result.id);
  await assert.rejects(svc.create(owner,{...dto,wrongNumbers:[]}),{code:'paper_idempotency_conflict'});
  await assert.rejects(svc.get(other,a.result.id));await assert.rejects(svc.image(other,a.result.id,2,'image'));
 }
 assert.equal((await svc.list(owner)).items.length,2);assert.equal((await svc.list(other)).items.length,0);
 const notes=await svc.notebook(owner);assert.equal(notes.items.length,9);assert.ok(notes.items.every(i=>i.selectedOptionId===null&&i.review.options.every(o=>!o.selected)));assert.equal(notes.hasMore,false);
 assert.equal((await svc.image(owner,ids[0],46,'common')).toString(),'72-common47-48.webp');
 assert.equal((await svc.image(owner,ids[0],2,'image')).toString(),'72-03.webp');
 await assert.rejects(svc.image(owner,ids[0],2,'common'));
 assert.equal((await q.query('SELECT count(*)::int n FROM hanq.paper_exam_result_items')).rows[0].n,100);
 for(const [t,n] of Object.entries(before))assert.equal((await q.query('SELECT count(*)::int n FROM hanq.'+t)).rows[0].n,n,t);
 await assert.rejects(q.query('UPDATE hanq.paper_exam_results SET score=100 WHERE id=$1',[ids[0]]));
 await q.query("INSERT INTO hanq.wrong_history_resets(user_id,island,reset_at) VALUES($1,'history',$2)",[owner,new Date(now.getTime()+1000)]);
 assert.equal((await svc.notebook(owner)).items.length,0);assert.equal((await svc.list(owner)).items.length,2);
 await assert.rejects(svc.image(owner,ids[0],2,'image'));
 console.log('PASS: full migrations/replay, synthetic weighted scores, idempotency/conflict, 100 snapshots, 9 synthetic wrongs, cross-owner denial, image/common, no online/XP writes, reset gating, immutability');
 await db.close();
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
