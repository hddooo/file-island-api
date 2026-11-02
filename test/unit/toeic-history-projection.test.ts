import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHistory,loadStudyHistory} from '../../src/toeic-cbt/history';
import type {Queryable} from '../../src/db/db.service';
import {toeicFixture} from '../helpers/toeic-fixture';

test('history projection omits script groups and metadata without losing grading fields or owner scope',async()=>{
 const content=toeicFixture();const queries:string[]=[];
 const q={query:async(sql:string,args:unknown[])=>{queries.push(sql);assert.deepEqual(args,['owner']);return{rows:sql.includes('FROM hanq.toeic_cbt_collections')?[{id:'a',source_key:'round',content:{questions:content.questions,wrongNumbers:content.wrongNumbers}}]:[{collection_id:'a',question_number:1,correct:false,selected_option:'A',practice:true}]};}} as unknown as Queryable;
 const history=await loadStudyHistory(q,'owner');assert.equal(queries.length,2);assert.match(queries[0],/content - 'groups' - 'metadata' AS content/);assert.match(queries[0],/WHERE user_id=\$1/);assert.equal(history.get('round\0'+'1')?.wrongCount,2);assert.equal(history.get('round\0'+'1')?.practiceReviewed,true);
});
test('many attempts use indexed question lookup and preserve chronological recent outcomes',()=>{
 const content=toeicFixture();Object.defineProperty(content.questions,'find',{value:()=>{throw Error('linear question lookup must not run per attempt');}});
 const attempts=Array.from({length:1000},(_,i)=>({collection_id:'a',question_number:1,correct:i%2===0}));
 const h=aggregateHistory([{id:'a',source_key:'round',content}],attempts).get('round\0'+'1');assert.equal(h?.wrongCount,501);assert.deepEqual(h?.recentResults,[false,true,false]);assert.equal(h?.repeatedWrong,true);
});
