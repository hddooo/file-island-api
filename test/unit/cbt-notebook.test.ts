import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { CbtReviewService } from '../../src/cbt/cbt-review.service';
import { CreateCbtReviewDto } from '../../src/cbt/cbt-review.dto';
import type { DbService } from '../../src/db/db.service';
import type { CbtAssetsService } from '../../src/cbt/cbt-assets.service';
const owner='11111111-1111-4111-8111-111111111111';
const row={question_id:'exam-79-01',version:'original-version',exam_number:1,exam_round:79,position:0,points:2,run_id:'22222222-2222-4222-8222-222222222222',answer_option_id:'a',correct_option_id:'b',option_ids:['a','b','c','d','e'],public_payload:{},review_payload:{stem:'original synthetic question',image:'must-strip.webp'},era:'prehistory'};
test('notebook owner query uses only selected wrong finalized original exams and preserves stored versions',async()=>{
 let seen='';let values:unknown[]=[];
 const db={pool:{query:async(sql:string,args:unknown[])=>{seen=sql;values=args;return{rows:[row]};}}} as unknown as DbService;
 const service=new CbtReviewService(db,{now:()=>new Date()},{} as CbtAssetsService);
 const out=await service.notebook(owner);
 assert.deepEqual(values,[owner]);assert.match(seen,/i\.user_id=\$1/);assert.match(seen,/r\.user_id=i\.user_id/);assert.match(seen,/r\.status='final'/);assert.match(seen,/i\.correct=false/);assert.ok(seen.includes("hanq.wrong_history_visible(r.user_id,'history',r.created_at)"));assert.match(seen,/i\.answer_option_id IS NOT NULL/);assert.match(seen,/v\.version=i\.version/);assert.doesNotMatch(seen,/hanq\.attempts|cbt_question_stars|is_current|cbt_review_items/);
 assert.equal(out.items[0].version,'original-version');assert.equal(out.items[0].review.correctNumber,2);assert.equal(out.items[0].review.status,'wrong');assert.equal(out.items[0].points,2);assert.equal(out.items[0].image,`/api/v1/cbt/runs/${row.run_id}/questions/0/image`);assert.equal(out.hasMore,false);assert.equal(out.scope,'finalized-exam-selected-wrong');
});
test('notebook reports bounded overflow rather than claiming complete results',async()=>{
 const db={pool:{query:async()=>({rows:Array.from({length:501},(_,i)=>({...row,question_id:'synthetic-'+i}))})}} as unknown as DbService;
 const out=await new CbtReviewService(db,{now:()=>new Date()},{} as CbtAssetsService).notebook(owner);
 assert.equal(out.items.length,500);assert.equal(out.hasMore,true);
});
test('review selection allows only explicit exam-wrong-only or legacy omitted mode',async()=>{
 for(const selection of [undefined,'exam-wrong-only']){const dto=Object.assign(new CreateCbtReviewDto(),{round:79,idempotencyKey:'notebook-valid-key',selection});assert.equal((await validate(dto)).length,0);}
 const bad=Object.assign(new CreateCbtReviewDto(),{round:79,idempotencyKey:'notebook-valid-key',selection:'everything'});assert.ok((await validate(bad)).some(x=>x.property==='selection'));
});
test('wrong-only replay isolates idempotency and source query; no empty review is created',async()=>{
 const queries:{sql:string;args:unknown[]}[]=[];
 const q={query:async(sql:string,args:unknown[]=[])=>{queries.push({sql,args});return{rows:[],rowCount:0};}};
 const db={tx:async(fn:(x:typeof q)=>unknown)=>fn(q)} as unknown as DbService;
 const service=new CbtReviewService(db,{now:()=>new Date()},{} as CbtAssetsService);
 await assert.rejects(()=>service.create(owner,{round:79,idempotencyKey:'same-valid-key',selection:'exam-wrong-only'}),{code:'review_empty'});
 const key=queries.find(x=>x.sql.includes('idempotency_key'));assert.deepEqual(key?.args,[owner,'exam-wrong-only|same-valid-key']);
 const source=queries.find(x=>x.sql.includes('SELECT * FROM (SELECT DISTINCT'));assert.ok(source);assert.deepEqual(source.args,[owner,79]);assert.match(source.sql,/r\.status='final'/);assert.match(source.sql,/i\.correct=false/);assert.match(source.sql,/answer_option_id IS NOT NULL/);assert.doesNotMatch(source.sql,/cbt_question_stars|hanq\.attempts|is_current/);assert.ok(!queries.some(x=>x.sql.startsWith('INSERT')));
});
