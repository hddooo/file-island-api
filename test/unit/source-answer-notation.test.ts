import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sourceGrade,applySourceBatch,applySourceMutation,initialSourceProgress,workspaceFromLegacy,type SourceItem} from '../../src/textbook/source-blank-progress';
// Synthetic fixtures: no private source files or database access.
function item(parts:string[],separate=true,kind='fill-in',orderMatters=true):SourceItem {
 const answers=parts.map((text,i)=>({id:'a'+i,text}));
 return {id:'synthetic',kind,verification:{status:'source-verified'},answers,answer:{text:parts.join(', '),orderMatters},blanks:separate?answers.map(a=>({id:'b'+a.id,answerIds:[a.id]})):[{id:'b',answerIds:answers.map(a=>a.id)}]};
}
const compound=item(['동의보감 (광해군)']),alias=item(['백운동서원 (=소수서원)']);
const cases:[SourceItem,string[],boolean][]=[];
for(const v of ['동의보감 (광해군)','동의보감/광해군','동의보감 , 광해군',' 동의보감\n/ 광해군 ','동의보감 / 광해군'.normalize('NFD')])cases.push([compound,[v],true]);
for(const v of ['동의보감','광해군','광해군/동의보감','동의보감 / 광해','동의보감,광해군,기타','동의보감,,광해군','동의보감/,광해군','동의보감 광해군','동의보감(=광해군)'])cases.push([compound,[v],false]);
for(const v of ['백운동서원 (=소수서원)','백운동서원','소수서원',' 소수 서원 ','소수서원'.normalize('NFD')])cases.push([alias,[v],true]);
for(const v of ['백운동','소수','백운동서원/소수서원','백운동서원,소수서원','백운동서원(소수서원)','소수서원,기타'])cases.push([alias,[v],false]);
cases.push([item(['동의보감 (광해군)','백운동서원 (=소수서원)']),['동의보감, 광해군','소수서원'],true]);
cases.push([item(['동의보감 (광해군)','백운동서원 (=소수서원)']),['동의보감','소수서원'],false]);
for(const [canonical,response] of [['3·1 운동','31운동'],['가/나','가,나'],['가,나','가/나'],['가(나/다)','가/나/다'],['가(=나/다)','나'],['가(나)','나']])cases.push([item([canonical]),[response],false]);
cases.push([item(['가','나'],false,'fill-in',false),['나, 가'],true],[item(['가','나'],false),['나, 가'],false],[item(['동의보감 (광해군)','기타'],false),['동의보감,광해군,기타'],false]);
cases.push([item(['①','②','③'],false,'sequence'),['1,2,3'],true],[item(['①','②','③'],false,'sequence'),['1/2/3'],false],[item(['①','②','③'],false,'sequence'),['2,1,3'],false]);
test('source notation grading and both mutation paths agree, preserving exact values and canonical source',()=>{
 for(const [q,values,correct] of cases){
  const before=JSON.stringify(q),initial=workspaceFromLegacy(initialSourceProgress(),1),initialBefore=JSON.stringify(initial);
  assert.equal(sourceGrade(q,values),correct,JSON.stringify(values));
  const batch=applySourceBatch([q],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:q.id,values,submitted:true,checkedSlots:values.map(()=>true)}]});
  assert.equal(batch.responses[q.id].correct,correct);assert.deepEqual(batch.responses[q.id].values,values);
  const legacy=applySourceMutation([q],initialSourceProgress(),{version:'fixture',revision:0,mutationId:randomUUID(),position:0,action:'answer',values});
  assert.equal(legacy.responses[0].correct,correct);assert.deepEqual(legacy.responses[0].values,values);
  assert.equal(JSON.stringify(q),before);assert.equal(JSON.stringify(initial),initialBefore);
 }
});
test('unsubmitted edits stay ungraded and unrelated saved records are not regraded',()=>{
 const initial=workspaceFromLegacy(initialSourceProgress(),1);initial.responses.old={values:['소수서원'],submitted:true,correct:false,checkedSlots:[true]};
 const next=applySourceBatch([alias],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:alias.id,values:['소수서원'],submitted:false,checkedSlots:[false]}]});
 assert.equal(next.responses[alias.id].correct,null);assert.deepEqual(next.responses.old,initial.responses.old);assert.equal(initial.responses[alias.id],undefined);
});
