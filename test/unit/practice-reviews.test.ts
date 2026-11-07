import test from 'node:test';
import assert from 'node:assert/strict';
import {ToeicPracticeService} from '../../src/toeic-cbt/practice';
import {toeicFixture} from '../helpers/toeic-fixture';
import type {DbService,Queryable} from '../../src/db/db.service';
function fixture(published:string|null=null,allowed=true){
 const content=toeicFixture(),queries:string[]=[];
 const db={tx:async<T>(fn:(q:Queryable)=>Promise<T>)=>fn({query:async(sql:string,args:unknown[])=>{
  queries.push(sql);
  if(sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')return {rows:[]};
  if(sql.includes('toeic_member_notebook'))return {rows:published?[{owner_id:published}]:[]};
  assert(sql.startsWith('SELECT id,source_key,title,content'));
  assert.deepEqual(args,[published||'viewer','collection']);
  return {rows:allowed?[{id:'collection',source_key:'synthetic',title:'test',content}]:[]};
 }} as unknown as Queryable)};
 return {content,queries,service:new ToeicPracticeService(db as unknown as DbService,{now:()=>new Date()})};
}
test('read-only reviews expose source answers without recording a submission',async()=>{
 const f=fixture(),r=await f.service.reviews('viewer','collection');
 assert.equal(r.collectionId,'collection');assert.equal(r.items.length,4);
 assert.equal(r.items[1].review.correctOptionId,'C');assert.equal(r.items[1].review.explanation,'Synthetic explanation 16');
 assert.equal(r.items[1].review.officiallyVerified,true);assert.deepEqual(r.items[1].review.choices,f.content.questions[1].choices);
 assert.equal(f.queries.length,3);assert(!f.queries.some(q=>/INSERT|UPDATE|DELETE|FOR UPDATE/.test(q)));
});
test('reviews use existing explicitly published notebook scope',async()=>{const f=fixture('published-owner');assert.equal((await f.service.reviews('viewer','collection')).items.length,4);});
test('unavailable foreign collection returns not found, no answers',async()=>{const f=fixture(null,false);await assert.rejects(f.service.reviews('viewer','collection'));});
test('missing source key is omitted and inferred key remains explicitly unverified',async()=>{const f=fixture();f.content.questions[0].correctOptionId=null;f.content.questions[1].answerVerified=false;f.content.questions[1].answerStatus='assistant_inferred_not_officially_verified';const r=await f.service.reviews('viewer','collection');assert(!r.items.some(i=>i.number===1));assert.equal(r.items.find(i=>i.number===16)?.review.officiallyVerified,false);});
